import {
  db,
  getMeta,
  markFirstSyncComplete,
  newId,
  setMeta,
  type Task,
  type TaskList,
} from '@/db/db'
import { parseGoogleDue, toGoogleDue } from '@/lib/dates'
import { formatTitle, parseTitle } from '@/lib/title'
import {
  TasksApiError,
  type GoogleTask,
  type TasksClient,
  type TaskWrite,
} from '@/sync/google-tasks'

/**
 * Push local changes, then pull remote ones.
 *
 * The conflict rule is deliberately a single branch: a locally modified row
 * wins and is pushed; anything else is overwritten from the server. A row
 * deleted on the server stays deleted even if it was edited locally. This is
 * only safe because one device writes — see the README.
 */

/** Deletions whose tombstones Google has purged only surface in a full pull. */
const FULL_RESYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

/** Slack on the watermark, so a task updated mid-pull isn't skipped next time. */
const WATERMARK_OVERLAP_MS = 60 * 1000

const LAST_FULL_SYNC = 'lastFullSync'
const watermarkKey = (listRemoteId: string) => `watermark:${listRemoteId}`

export interface SyncFailure {
  taskId: string
  operation: 'create' | 'update' | 'delete'
  error: unknown
}

export interface SyncResult {
  pushed: number
  pulled: number
  fullResync: boolean
  /** Rows that could not be pushed. They stay dirty and retry next sync. */
  failures: SyncFailure[]
}

/**
 * A row that is gone on the server. Google answers 404 for a task that was
 * deleted, and 410 once it has been purged entirely.
 */
function isGoneRemotely(error: unknown): boolean {
  return error instanceof TasksApiError && (error.status === 404 || error.status === 410)
}

export async function sync(
  client: TasksClient,
  options: { now?: number; force?: boolean } = {},
): Promise<SyncResult> {
  const now = options.now ?? Date.now()

  // Push first: local edits then come back in the pull already reconciled,
  // rather than being clobbered by a stale server copy.
  const failures: SyncFailure[] = []
  const pushed = await pushChanges(client, failures)

  const lastFullSync = await getMeta<number>(LAST_FULL_SYNC)
  const fullResync =
    options.force === true ||
    lastFullSync === undefined ||
    now - lastFullSync > FULL_RESYNC_INTERVAL_MS

  const pulled = await pullChanges(client, fullResync)

  if (fullResync) await setMeta(LAST_FULL_SYNC, now)
  await markFirstSyncComplete()

  return { pushed, pulled, fullResync, failures }
}

/* --- push ----------------------------------------------------------------- */

/*
 * Every row is pushed independently and a failure is recorded rather than
 * thrown. One task the server rejects must not wedge syncing for all the
 * others — that failure mode is silent and permanent, which is the worst kind.
 */

async function pushChanges(client: TasksClient, failures: SyncFailure[]): Promise<number> {
  const deleted = await pushDeletes(client, failures)
  const created = await pushCreates(client, failures)
  const updated = await pushUpdates(client, failures)
  return deleted + created + updated
}

async function pushDeletes(client: TasksClient, failures: SyncFailure[]): Promise<number> {
  const rows = await db.tasks.where('isDeleted').equals(1).toArray()
  let pushed = 0

  for (const row of rows) {
    const listRemoteId = await remoteListId(row.listId)

    if (row.remoteId && listRemoteId) {
      try {
        await client.deleteTask(listRemoteId, row.remoteId)
      } catch (error) {
        // Already gone is the outcome we wanted anyway.
        if (!isGoneRemotely(error)) {
          failures.push({ taskId: row.id, operation: 'delete', error })
          continue // leave flagged so the delete retries next sync
        }
      }
    }

    await db.tasks.delete(row.id)
    pushed++
  }

  return pushed
}

/**
 * Rows Google has never seen. A checklist can be created offline under a parent
 * that is itself unpushed, so parents have to go first — the insert needs the
 * parent's *remote* id. Repeated passes handle any depth without building a
 * dependency graph.
 */
async function pushCreates(client: TasksClient, failures: SyncFailure[]): Promise<number> {
  let remaining = await db.tasks
    .filter((task) => task.remoteId === null && task.isDeleted === 0)
    .toArray()
  let pushed = 0

  while (remaining.length > 0) {
    const blocked: Task[] = []

    for (const row of remaining) {
      const listRemoteId = await remoteListId(row.listId)
      if (!listRemoteId) continue // list itself is not on the server; skip

      let parentRemoteId: string | undefined
      if (row.parent !== null) {
        const parent = await db.tasks.get(row.parent)
        if (!parent?.remoteId) {
          blocked.push(row)
          continue
        }
        parentRemoteId = parent.remoteId
      }

      try {
        const created = await client.insertTask(
          listRemoteId,
          toWrite(row),
          parentRemoteId ? { parent: parentRemoteId } : undefined,
        )
        await db.tasks.update(row.id, {
          remoteId: created.id,
          updated: created.updated,
          isDirty: 0,
        })
        pushed++
      } catch (error) {
        // Retried next sync. If the create actually landed and only the
        // response was lost, that retry duplicates the task — accepted, since
        // the API has no idempotency key and there is no backend to hold one.
        failures.push({ taskId: row.id, operation: 'create', error })
      }
    }

    // A whole pass with no progress means these point at a parent that will
    // never be pushed — it was deleted, or the row was orphaned. Promote them
    // to top level so they survive as ordinary tasks instead of spinning here.
    if (blocked.length > 0 && blocked.length === remaining.length) {
      for (const row of blocked) {
        await db.tasks.update(row.id, { parent: null })
        row.parent = null
      }
    }

    remaining = blocked
  }

  return pushed
}

async function pushUpdates(client: TasksClient, failures: SyncFailure[]): Promise<number> {
  const rows = await db.tasks
    .where('isDirty')
    .equals(1)
    .filter((task) => task.remoteId !== null && task.isDeleted === 0)
    .toArray()
  let pushed = 0

  for (const row of rows) {
    const listRemoteId = await remoteListId(row.listId)
    if (!listRemoteId || !row.remoteId) continue

    try {
      const patched = await client.patchTask(listRemoteId, row.remoteId, toWrite(row))
      await db.tasks.update(row.id, { updated: patched.updated, isDirty: 0 })
      pushed++
    } catch (error) {
      // Deleted on the server while edited here. The remote delete wins, so
      // the local row goes rather than being resurrected under a new id.
      if (isGoneRemotely(error)) {
        await db.tasks.delete(row.id)
        continue
      }
      failures.push({ taskId: row.id, operation: 'update', error })
    }
  }

  return pushed
}

/** Local shape to API shape. The `!` priority prefix goes back on here. */
function toWrite(task: Task): TaskWrite {
  return {
    title: formatTitle(task.title, task.priority),
    notes: task.notes,
    due: toGoogleDue(task.due),
    status: task.status,
    completed: task.completedAt,
  }
}

/* --- pull ----------------------------------------------------------------- */

async function pullChanges(client: TasksClient, fullResync: boolean): Promise<number> {
  await pullLists(client)

  const lists = await db.lists.toArray()
  let pulled = 0

  for (const list of lists) {
    if (!list.remoteId) continue

    const key = watermarkKey(list.remoteId)
    const updatedMin = fullResync ? undefined : await getMeta<string>(key)

    const remote = await client.listTasks(list.remoteId, updatedMin ? { updatedMin } : undefined)
    await applyRemoteTasks(list, remote, fullResync)
    pulled += remote.length

    const watermark = highestUpdated(remote)
    if (watermark) await setMeta(key, watermark)
  }

  return pulled
}

/** Lists are pull-only: this app never creates or renames them. */
async function pullLists(client: TasksClient): Promise<void> {
  const remoteLists = await client.listTaskLists()

  for (const remote of remoteLists) {
    const local = await db.lists.where('remoteId').equals(remote.id).first()
    if (local) {
      await db.lists.update(local.id, { title: remote.title, updated: remote.updated })
    } else {
      await db.lists.add({
        id: newId(),
        remoteId: remote.id,
        title: remote.title,
        updated: remote.updated,
        isDirty: 0,
        isDeleted: 0,
      })
    }
  }

  // tasklists.list always returns everything, so absence means deleted.
  const liveIds = new Set(remoteLists.map((list) => list.id))
  for (const local of await db.lists.toArray()) {
    if (local.remoteId && !liveIds.has(local.remoteId)) {
      await db.tasks.where('listId').equals(local.id).delete()
      await db.lists.delete(local.id)
    }
  }
}

async function applyRemoteTasks(
  list: TaskList,
  remote: GoogleTask[],
  fullResync: boolean,
): Promise<void> {
  const seen = new Set<string>()
  /** Local id to the *remote* parent id, resolved in a second pass. */
  const parents = new Map<string, string | null>()

  for (const task of remote) {
    seen.add(task.id)
    const local = await db.tasks.where('remoteId').equals(task.id).first()

    // A remote delete beats a local edit: there is no clean way to resurrect a
    // row, and recreating it would change its id.
    if (task.deleted) {
      if (local) await db.tasks.delete(local.id)
      continue
    }

    // The one conflict branch. A dirty row is about to be pushed, so leaving it
    // alone is the whole of "local wins".
    if (local?.isDirty === 1) continue

    const { title, priority } = parseTitle(task.title ?? '')
    const fields = {
      listId: list.id,
      title,
      priority,
      notes: task.notes ?? '',
      due: parseGoogleDue(task.due),
      status: task.status ?? ('needsAction' as const),
      completedAt: task.completed ?? null,
      updated: task.updated,
      isDirty: 0 as const,
      isDeleted: 0 as const,
    }

    if (local) {
      await db.tasks.update(local.id, fields)
      parents.set(local.id, task.parent ?? null)
    } else {
      const id = newId()
      await db.tasks.add({ id, remoteId: task.id, parent: null, ...fields })
      parents.set(id, task.parent ?? null)
    }
  }

  // Second pass: a child can arrive before its parent, so parents are only
  // resolvable once every row in the batch exists.
  for (const [localId, remoteParent] of parents) {
    const parent = remoteParent
      ? ((await db.tasks.where('remoteId').equals(remoteParent).first())?.id ?? null)
      : null
    await db.tasks.update(localId, { parent })
  }

  // Only a full pull can treat absence as deletion — an incremental one returns
  // just the changes, so almost everything is legitimately absent.
  if (fullResync) {
    const local = await db.tasks.where('listId').equals(list.id).toArray()
    for (const row of local) {
      if (row.remoteId && !seen.has(row.remoteId)) {
        await db.tasks.delete(row.id)
      }
    }
  }
}

/**
 * The watermark is the newest `updated` the *server* reported, minus a minute.
 * Deriving it from the server's own clock is the point: using `Date.now()` here
 * compares a device clock against server timestamps, and a phone running a
 * minute fast would silently skip every edit made in that minute, forever.
 *
 * Unlike a task's due date, `updated` is a genuine instant, so `Date` is the
 * right tool here.
 */
function highestUpdated(tasks: GoogleTask[]): string | null {
  let highest = Number.NEGATIVE_INFINITY

  for (const task of tasks) {
    const time = Date.parse(task.updated)
    if (!Number.isNaN(time) && time > highest) highest = time
  }

  if (highest === Number.NEGATIVE_INFINITY) return null
  return new Date(highest - WATERMARK_OVERLAP_MS).toISOString()
}

async function remoteListId(localListId: string): Promise<string | null> {
  const list = await db.lists.get(localListId)
  return list?.remoteId ?? null
}

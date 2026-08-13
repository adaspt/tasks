import Dexie, { type EntityTable } from 'dexie'
import type { FloatingDate } from '@/lib/dates'
import type { Priority } from '@/lib/title'

/**
 * Every row has a locally generated `id` that never changes, plus a nullable
 * `remoteId` holding Google's identifier. Keeping them separate means nothing
 * has to be rewritten when a create finally reaches the server: parent
 * pointers, open routes and React keys all keep referring to the same row.
 *
 * A row with `remoteId === null` has never been pushed, so deleting it needs no
 * network call at all.
 */
interface SyncedRow {
  id: string
  remoteId: string | null
  /** Google's `updated` timestamp. Feeds the sync watermark; null until synced. */
  updated: string | null
  /** Needs pushing. Numeric because IndexedDB cannot index booleans. */
  isDirty: 0 | 1
  /** Deleted locally, delete not yet pushed. Also numeric, same reason. */
  isDeleted: 0 | 1
}

export interface TaskList extends SyncedRow {
  title: string
}

export interface Task extends SyncedRow {
  listId: string
  /** Display title: the `!` priority prefix is already stripped. */
  title: string
  priority: Priority
  notes: string
  /** Start date — "the day it should start bothering me". Null means backlog. */
  due: FloatingDate | null
  status: 'needsAction' | 'completed'
  completedAt: string | null
  /** Local id of the parent task, for checklists. Null means top level. */
  parent: string | null
}

export interface MetaRow {
  key: string
  value: unknown
}

/**
 * Indexes cover only what is queried by key. View filtering and sorting happen
 * in JavaScript over the full task array, which is fine at personal-backlog
 * scale and avoids a pile of compound indexes.
 *
 * Note `parent` and `due` are deliberately *not* indexed: IndexedDB skips null
 * values entirely, so `where('due').equals(null)` silently matches nothing.
 * Filtering those in JS is correct; indexing them would need a sentinel value.
 */
export const db = new Dexie('tasks') as Dexie & {
  lists: EntityTable<TaskList, 'id'>
  tasks: EntityTable<Task, 'id'>
  meta: EntityTable<MetaRow, 'key'>
}

db.version(1).stores({
  lists: 'id, remoteId, isDirty, isDeleted',
  tasks: 'id, remoteId, listId, isDirty, isDeleted',
  meta: 'key',
})

export function newId(): string {
  return crypto.randomUUID()
}

/* --- meta ---------------------------------------------------------------- */

const HAS_SYNCED = 'hasCompletedFirstSync'

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key)
  return row?.value as T | undefined
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}

/**
 * The first-run gate keys off this, not off holding a valid access token —
 * tokens expire hourly, and gating on one would lock the user out every hour.
 */
export async function hasCompletedFirstSync(): Promise<boolean> {
  return (await getMeta<boolean>(HAS_SYNCED)) === true
}

export async function markFirstSyncComplete(): Promise<void> {
  await setMeta(HAS_SYNCED, true)
}

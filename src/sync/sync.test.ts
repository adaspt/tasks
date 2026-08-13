import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, hasCompletedFirstSync } from '@/db/db'
import { createTask, deleteTask, updateTask } from '@/db/queries'
import { floatingDate } from '@/lib/dates'
import { FakeTasksClient } from '@/sync/fake-client'
import { sync } from '@/sync/sync'

let google: FakeTasksClient

beforeEach(async () => {
  await db.tasks.clear()
  await db.lists.clear()
  await db.meta.clear()
  google = new FakeTasksClient()
})

const localTask = (title: string) => db.tasks.filter((task) => task.title === title).first()
const localTitles = async () => (await db.tasks.toArray()).map((task) => task.title).sort()

describe('first pull', () => {
  it('brings down lists and tasks', async () => {
    const list = google.addList('Personal')
    google.addTask(list.id, { title: 'Renew passport' })

    await sync(google)

    expect(await db.lists.count()).toBe(1)
    expect(await localTitles()).toEqual(['Renew passport'])
    expect(await hasCompletedFirstSync()).toBe(true)
  })

  it('reads the `!` prefix as priority and strips it', async () => {
    const list = google.addList('Personal')
    google.addTask(list.id, { title: '! Renew passport' })

    await sync(google)

    const task = await localTask('Renew passport')
    expect(task?.priority).toBe(1)
    expect(task?.title).toBe('Renew passport')
  })

  it('reads due as a floating date, not an instant', async () => {
    const list = google.addList('Personal')
    google.addTask(list.id, { title: 'Dentist', due: '2026-08-13T00:00:00.000Z' })

    await sync(google)

    expect((await localTask('Dentist'))?.due).toBe('2026-08-13')
  })

  it('maps a subtask onto its parent local id, whatever the order', async () => {
    const list = google.addList('Personal')
    // Child added first, so the parent does not exist when it is processed.
    const parent = google.addTask(list.id, { title: 'Weekly shop' })
    const child = google.addTask(list.id, { title: 'Bread', parent: parent.id })
    google.tasks.reverse()

    await sync(google)

    const parentRow = await localTask('Weekly shop')
    const childRow = await localTask('Bread')
    expect(childRow?.parent).toBe(parentRow?.id)
    expect(childRow?.remoteId).toBe(child.id)
  })
})

describe('push', () => {
  it('creates a local-only task and records the remote id', async () => {
    const list = google.addList('Personal')
    await sync(google)
    const listRow = await db.lists.where('remoteId').equals(list.id).first()

    await createTask({ listId: listRow!.id, title: 'Fix the shed', priority: 1 })
    await sync(google)

    const row = await localTask('Fix the shed')
    expect(row?.remoteId).not.toBeNull()
    expect(row?.isDirty).toBe(0)
    // Priority goes back onto the wire as a prefix.
    expect(google.tasks.find((t) => t.id === row?.remoteId)?.title).toBe('! Fix the shed')
  })

  it('pushes a parent before the child that references it', async () => {
    const list = google.addList('Personal')
    await sync(google)
    const listRow = await db.lists.where('remoteId').equals(list.id).first()

    // Both created offline: the child points at a parent with no remote id.
    const parentId = await createTask({ listId: listRow!.id, title: 'Weekly shop' })
    await createTask({ listId: listRow!.id, title: 'Bread', parent: parentId })

    await sync(google)

    const parentRow = await db.tasks.get(parentId)
    const childRemote = google.tasks.find((task) => task.title === 'Bread')
    expect(childRemote?.parent).toBe(parentRow?.remoteId)
  })

  it('promotes an orphan rather than looping forever', async () => {
    const list = google.addList('Personal')
    await sync(google)
    const listRow = await db.lists.where('remoteId').equals(list.id).first()

    await createTask({ listId: listRow!.id, title: 'Orphan', parent: 'missing-parent' })
    await sync(google)

    const row = await localTask('Orphan')
    expect(row?.parent).toBeNull()
    expect(row?.remoteId).not.toBeNull()
  })

  it('sends an edit and clears the dirty flag', async () => {
    const list = google.addList('Personal')
    const remote = google.addTask(list.id, { title: 'Dentist' })
    await sync(google)

    const row = await localTask('Dentist')
    await updateTask(row!.id, { title: 'Dentist appointment' })
    expect((await db.tasks.get(row!.id))?.isDirty).toBe(1)

    await sync(google)

    expect(google.tasks.find((t) => t.id === remote.id)?.title).toBe('Dentist appointment')
    expect((await db.tasks.get(row!.id))?.isDirty).toBe(0)
  })

  it('deletes remotely, then drops the row', async () => {
    const list = google.addList('Personal')
    const remote = google.addTask(list.id, { title: 'Dentist' })
    await sync(google)

    await deleteTask((await localTask('Dentist'))!.id)
    await sync(google)

    expect(google.tasks.find((t) => t.id === remote.id)?.deleted).toBe(true)
    expect(await localTask('Dentist')).toBeUndefined()
  })

  it('never calls the API for a row Google has not seen', async () => {
    const list = google.addList('Personal')
    await sync(google)
    const listRow = await db.lists.where('remoteId').equals(list.id).first()

    const id = await createTask({ listId: listRow!.id, title: 'Never pushed' })
    await deleteTask(id)

    expect(await db.tasks.get(id)).toBeUndefined()
    await sync(google)
    expect(google.tasks.some((task) => task.title === 'Never pushed')).toBe(false)
  })
})

describe('conflicts', () => {
  it('lets a locally edited row win over the server copy', async () => {
    const list = google.addList('Personal')
    const remote = google.addTask(list.id, { title: 'Dentist' })
    await sync(google)

    const row = await localTask('Dentist')
    await updateTask(row!.id, { title: 'Local wins' })
    google.touch(remote.id, { title: 'Remote loses' })

    await sync(google)

    expect((await db.tasks.get(row!.id))?.title).toBe('Local wins')
    expect(google.tasks.find((t) => t.id === remote.id)?.title).toBe('Local wins')
  })

  it('lets a remote delete beat a local edit', async () => {
    const list = google.addList('Personal')
    const remote = google.addTask(list.id, { title: 'Dentist' })
    await sync(google)

    const row = await localTask('Dentist')
    google.remove(remote.id)
    await updateTask(row!.id, { title: 'Edited offline' })

    // The push 404s on a deleted task, which is how it learns the row is gone.
    const result = await sync(google)

    expect(await db.tasks.get(row!.id)).toBeUndefined()
    expect(result.failures).toEqual([])
  })

  it('does not overwrite a dirty row whose push failed', async () => {
    const list = google.addList('Personal')
    const remote = google.addTask(list.id, { title: 'Dentist' })
    await sync(google)

    const row = await localTask('Dentist')
    await updateTask(row!.id, { title: 'Local edit' })
    google.touch(remote.id, { title: 'Server edit' })

    // The push fails, so the row is still dirty when the pull runs. This is the
    // only situation where the conflict guard actually fires: normally the push
    // has already put the local value on the server, and the pull agrees with
    // it either way.
    google.patchTask = () => Promise.reject(new Error('network down'))
    const result = await sync(google)

    expect(result.failures).toHaveLength(1)
    const after = await db.tasks.get(row!.id)
    expect(after?.title).toBe('Local edit')
    expect(after?.isDirty).toBe(1)
  })

  it('treats an already-deleted task as a successful delete', async () => {
    const list = google.addList('Personal')
    const remote = google.addTask(list.id, { title: 'Dentist' })
    await sync(google)

    const row = await localTask('Dentist')
    google.remove(remote.id)
    await deleteTask(row!.id)

    const result = await sync(google)

    expect(await db.tasks.get(row!.id)).toBeUndefined()
    expect(result.failures).toEqual([])
  })
})

describe('push failures', () => {
  /** Fails every write, the way a network drop or a 500 would. */
  function breakWrites(client: FakeTasksClient, message = 'network down') {
    const boom = () => Promise.reject(new Error(message))
    client.insertTask = boom
    client.patchTask = boom
  }

  it('reports a failed create and keeps the row for next time', async () => {
    const list = google.addList('Personal')
    await sync(google)
    const listRow = await db.lists.where('remoteId').equals(list.id).first()

    const id = await createTask({ listId: listRow!.id, title: 'Fix the shed' })
    breakWrites(google)

    const result = await sync(google)

    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatchObject({ taskId: id, operation: 'create' })
    const row = await db.tasks.get(id)
    expect(row?.remoteId).toBeNull()
    expect(row?.isDirty).toBe(1)
  })

  it('does not let one bad row block the others', async () => {
    const list = google.addList('Personal')
    await sync(google)
    const listRow = await db.lists.where('remoteId').equals(list.id).first()

    const good = await createTask({ listId: listRow!.id, title: 'Good' })
    const bad = await createTask({ listId: listRow!.id, title: 'Bad' })

    const realInsert = google.insertTask.bind(google)
    google.insertTask = (listId, task, options) =>
      task.title === 'Bad'
        ? Promise.reject(new Error('rejected'))
        : realInsert(listId, task, options)

    const result = await sync(google)

    expect((await db.tasks.get(good))?.remoteId).not.toBeNull()
    expect((await db.tasks.get(bad))?.remoteId).toBeNull()
    expect(result.failures).toHaveLength(1)
  })

  it('still pulls when a push failed', async () => {
    const list = google.addList('Personal')
    await sync(google)
    const listRow = await db.lists.where('remoteId').equals(list.id).first()

    await createTask({ listId: listRow!.id, title: 'Stuck' })
    google.addTask(list.id, { title: 'From the server' })
    breakWrites(google)

    const result = await sync(google)

    expect(result.failures).toHaveLength(1)
    expect(await localTitles()).toEqual(['From the server', 'Stuck'])
  })

  it('recovers on the next sync once writes work again', async () => {
    const list = google.addList('Personal')
    await sync(google)
    const listRow = await db.lists.where('remoteId').equals(list.id).first()

    const id = await createTask({ listId: listRow!.id, title: 'Fix the shed' })
    const realInsert = google.insertTask.bind(google)
    breakWrites(google)
    await sync(google)

    google.insertTask = realInsert
    const result = await sync(google)

    expect(result.failures).toEqual([])
    expect((await db.tasks.get(id))?.remoteId).not.toBeNull()
  })
})

describe('incremental pull', () => {
  it('sends a watermark on the second sync', async () => {
    const list = google.addList('Personal')
    google.addTask(list.id, { title: 'Dentist' })

    await sync(google)
    await sync(google)

    expect(google.listTasksCalls[0]?.updatedMin).toBeUndefined()
    expect(google.listTasksCalls[1]?.updatedMin).toBeDefined()
  })

  it('sets the watermark behind the newest change, so nothing is skipped', async () => {
    const list = google.addList('Personal')
    const remote = google.addTask(list.id, { title: 'Dentist' })
    await sync(google)

    const watermark = google.listTasksCalls.at(-1)?.updatedMin
    await sync(google)
    const second = google.listTasksCalls.at(-1)?.updatedMin

    expect(second).toBeDefined()
    expect(Date.parse(second!)).toBeLessThan(Date.parse(remote.updated))
    expect(watermark).toBeUndefined()
  })

  it('applies a later remote change', async () => {
    const list = google.addList('Personal')
    const remote = google.addTask(list.id, { title: 'Dentist' })
    await sync(google)

    google.touch(remote.id, { title: 'Dentist moved' })
    await sync(google)

    expect(await localTitles()).toEqual(['Dentist moved'])
  })

  it('does not treat absence as deletion', async () => {
    const list = google.addList('Personal')
    const keep = google.addTask(list.id, { title: 'Keep me' })
    const other = google.addTask(list.id, { title: 'Touch me' })
    await sync(google)

    // Only one task changes, so an incremental pull returns just that one.
    google.touch(other.id, { title: 'Touched' })
    await sync(google)

    expect(await localTitles()).toEqual(['Keep me', 'Touched'])
    expect(google.tasks.find((t) => t.id === keep.id)?.deleted).toBeUndefined()
  })
})

describe('full resync', () => {
  it('removes tasks the server no longer has, tombstone or not', async () => {
    const list = google.addList('Personal')
    google.addTask(list.id, { title: 'Purged' })
    google.addTask(list.id, { title: 'Kept' })
    await sync(google)

    // Vanished with no tombstone — what a purged deletion looks like.
    google.tasks = google.tasks.filter((task) => task.title !== 'Purged')

    await sync(google, { force: true })

    expect(await localTitles()).toEqual(['Kept'])
  })

  it('runs again once a week has passed', async () => {
    const list = google.addList('Personal')
    google.addTask(list.id, { title: 'Dentist' })

    const start = Date.parse('2026-08-13T09:00:00.000Z')
    expect((await sync(google, { now: start })).fullResync).toBe(true)
    expect((await sync(google, { now: start + 60_000 })).fullResync).toBe(false)

    const eightDays = start + 8 * 24 * 60 * 60 * 1000
    expect((await sync(google, { now: eightDays })).fullResync).toBe(true)
  })
})

describe('lists', () => {
  it('drops a list and its tasks when it disappears from the server', async () => {
    const personal = google.addList('Personal')
    const work = google.addList('Work')
    google.addTask(personal.id, { title: 'Dentist' })
    google.addTask(work.id, { title: 'Standup' })
    await sync(google)

    google.lists = google.lists.filter((list) => list.id !== work.id)
    google.tasks = google.tasks.filter((task) => task.listId !== work.id)
    await sync(google)

    expect(await db.lists.count()).toBe(1)
    expect(await localTitles()).toEqual(['Dentist'])
  })

  it('picks up a rename', async () => {
    const list = google.addList('Personal')
    await sync(google)

    const renamed = google.lists.find((candidate) => candidate.id === list.id)!
    renamed.title = 'Home'
    await sync(google)

    expect((await db.lists.toArray())[0]?.title).toBe('Home')
  })
})

describe('round trip', () => {
  it('preserves a task created offline through a later pull', async () => {
    const list = google.addList('Personal')
    await sync(google)
    const listRow = await db.lists.where('remoteId').equals(list.id).first()

    const id = await createTask({
      listId: listRow!.id,
      title: 'Fix the shed',
      priority: 1,
      due: floatingDate('2026-08-20'),
    })

    await sync(google)
    await sync(google, { force: true })

    const row = await db.tasks.get(id)
    expect(row?.title).toBe('Fix the shed')
    expect(row?.priority).toBe(1)
    expect(row?.due).toBe('2026-08-20')
    // Same local row throughout: the id never changes.
    expect(await db.tasks.count()).toBe(1)
  })
})

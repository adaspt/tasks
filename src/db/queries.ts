import { useLiveQuery } from 'dexie-react-hooks'
import { db, newId, type Task, type TaskList } from '@/db/db'
import { type FloatingDate } from '@/lib/dates'

/**
 * The whole task table, live. Small enough at personal scale that views filter
 * and sort it in memory rather than through compound indexes.
 */
export function useTasks(): Task[] | undefined {
  return useLiveQuery(() => db.tasks.where('isDeleted').equals(0).toArray(), [])
}

export function useLists(): TaskList[] | undefined {
  return useLiveQuery(() => db.lists.where('isDeleted').equals(0).sortBy('title'), [])
}

export function useTask(id: string | undefined): Task | undefined {
  return useLiveQuery(() => (id ? db.tasks.get(id) : undefined), [id])
}

/* --- mutations ------------------------------------------------------------ */
/*
 * Every mutation is local and immediate. Marking the row dirty is all that is
 * needed to queue it: the push set is a query over flagged rows, not a table.
 */

export async function createTask(input: {
  listId: string
  title: string
  priority?: 0 | 1
  due?: FloatingDate | null
  notes?: string
  parent?: string | null
}): Promise<string> {
  const id = newId()
  await db.tasks.add({
    id,
    remoteId: null,
    listId: input.listId,
    title: input.title.trim(),
    priority: input.priority ?? 0,
    notes: input.notes ?? '',
    due: input.due ?? null,
    status: 'needsAction',
    completedAt: null,
    parent: input.parent ?? null,
    updated: null,
    isDirty: 1,
    isDeleted: 0,
  })
  return id
}

export async function updateTask(
  id: string,
  changes: Partial<Omit<Task, 'id' | 'remoteId' | 'isDirty' | 'isDeleted'>>,
): Promise<void> {
  await db.tasks.update(id, { ...changes, isDirty: 1 })
}

export async function setTaskDone(id: string, done: boolean): Promise<void> {
  await updateTask(id, {
    status: done ? 'completed' : 'needsAction',
    completedAt: done ? new Date().toISOString() : null,
  })
}

/** Move a task's start date. Snooze is just this. */
export async function setTaskDue(id: string, due: FloatingDate | null): Promise<void> {
  await updateTask(id, { due })
}

export async function setTaskPriority(id: string, priority: 0 | 1): Promise<void> {
  await updateTask(id, { priority })
}

/**
 * A row Google has never seen can just go. Anything else is flagged so the
 * delete can be pushed, and stops appearing in views immediately.
 */
export async function deleteTask(id: string): Promise<void> {
  const task = await db.tasks.get(id)
  if (!task) return
  if (task.remoteId === null) {
    await db.tasks.delete(id)
    return
  }
  await db.tasks.update(id, { isDeleted: 1, isDirty: 1 })
}

import type { Task } from '@/db/db'
import { type FloatingDate, today } from '@/lib/dates'

export type ViewId = 'today' | 'later' | 'backlog'

export const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'later', label: 'Later' },
  { id: 'backlog', label: 'Backlog' },
]

/** Rows the three views draw from: open, top-level, not pending deletion. */
function visible(tasks: Task[]): Task[] {
  return tasks.filter(
    (task) => task.isDeleted === 0 && task.parent === null && task.status === 'needsAction',
  )
}

function byTitle(a: Task, b: Task): number {
  return a.title.localeCompare(b.title)
}

/** High priority first. */
function byPriority(a: Task, b: Task): number {
  return b.priority - a.priority
}

/** Earliest first. Tasks without a date sort last, though views never mix them. */
function byDue(a: Task, b: Task): number {
  if (a.due === b.due) return 0
  if (a.due === null) return 1
  if (b.due === null) return -1
  return a.due < b.due ? -1 : 1
}

function chain(...comparators: ((a: Task, b: Task) => number)[]) {
  return (a: Task, b: Task): number => {
    for (const compare of comparators) {
      const result = compare(a, b)
      if (result !== 0) return result
    }
    return 0
  }
}

/** Start date today or in the past. High priority first, then by date. */
export function todayTasks(tasks: Task[], now: FloatingDate = today()): Task[] {
  return visible(tasks)
    .filter((task) => task.due !== null && task.due <= now)
    .sort(chain(byPriority, byDue, byTitle))
}

/** Start date in the future. Sorted by date — flat, no day grouping. */
export function laterTasks(tasks: Task[], now: FloatingDate = today()): Task[] {
  return visible(tasks)
    .filter((task) => task.due !== null && task.due > now)
    .sort(chain(byDue, byPriority, byTitle))
}

/** No start date. High priority first. */
export function backlogTasks(tasks: Task[]): Task[] {
  return visible(tasks)
    .filter((task) => task.due === null)
    .sort(chain(byPriority, byTitle))
}

export function tasksForView(
  view: ViewId,
  tasks: Task[],
  now: FloatingDate = today(),
): Task[] {
  switch (view) {
    case 'today':
      return todayTasks(tasks, now)
    case 'later':
      return laterTasks(tasks, now)
    case 'backlog':
      return backlogTasks(tasks)
  }
}

/**
 * Recently completed, newest first — the undo list.
 *
 * Capped rather than filtered by age: a first sync can pull down a long history
 * of completed tasks, and "the last hundred things I finished" is both bounded
 * and more useful than an arbitrary cutoff date.
 */
export function completedTasks(tasks: Task[], limit = 100): Task[] {
  return tasks
    .filter(
      (task) =>
        task.isDeleted === 0 && task.parent === null && task.status === 'completed',
    )
    .sort((a, b) => {
      // Tasks completed in Google's app before this one existed may have no
      // timestamp; they sort last rather than jumping to the top.
      if (a.completedAt === b.completedAt) return a.title.localeCompare(b.title)
      if (a.completedAt === null) return 1
      if (b.completedAt === null) return -1
      return a.completedAt < b.completedAt ? 1 : -1
    })
    .slice(0, limit)
}

/** Checklist progress for a parent row: subtasks never appear in the views. */
export function checklistProgress(
  tasks: Task[],
  parentId: string,
): { done: number; total: number } | null {
  const children = tasks.filter((task) => task.parent === parentId && task.isDeleted === 0)
  if (children.length === 0) return null
  return {
    done: children.filter((task) => task.status === 'completed').length,
    total: children.length,
  }
}

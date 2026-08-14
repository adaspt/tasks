import { describe, expect, it } from 'vitest'
import type { Task } from '@/db/db'
import { floatingDate } from '@/lib/dates'
import {
  backlogTasks,
  checklistProgress,
  completedTasks,
  laterTasks,
  tasksForView,
  todayTasks,
} from './views'

const NOW = floatingDate('2026-08-13')

function task(overrides: Partial<Task> & { title: string }): Task {
  return {
    // Titles double as ids, so assertions read as names rather than uuids.
    id: overrides.title,
    remoteId: null,
    listId: 'list',
    priority: 0,
    notes: '',
    due: null,
    status: 'needsAction',
    completedAt: null,
    parent: null,
    updated: null,
    isDirty: 0,
    isDeleted: 0,
    ...overrides,
  }
}

const titles = (tasks: Task[]) => tasks.map((t) => t.title)

describe('todayTasks', () => {
  it('includes overdue as well as today, and excludes the future', () => {
    const tasks = [
      task({ title: 'overdue', due: floatingDate('2026-08-01') }),
      task({ title: 'today', due: NOW }),
      task({ title: 'tomorrow', due: floatingDate('2026-08-14') }),
    ]
    expect(titles(todayTasks(tasks, NOW))).toEqual(['overdue', 'today'])
  })

  it('sorts high priority first, then by date', () => {
    const tasks = [
      task({ title: 'normal-old', due: floatingDate('2026-08-01') }),
      task({ title: 'high-today', due: NOW, priority: 1 }),
      task({ title: 'normal-today', due: NOW }),
      task({ title: 'high-old', due: floatingDate('2026-08-02'), priority: 1 }),
    ]
    // Priority outranks date: a high-priority task from today still sits above
    // a normal one that has been overdue for a fortnight.
    expect(titles(todayTasks(tasks, NOW))).toEqual([
      'high-old',
      'high-today',
      'normal-old',
      'normal-today',
    ])
  })
})

describe('laterTasks', () => {
  it('is future-only and sorted by date, not by priority', () => {
    const tasks = [
      task({ title: 'far-high', due: floatingDate('2026-09-01'), priority: 1 }),
      task({ title: 'near-normal', due: floatingDate('2026-08-14') }),
      task({ title: 'today', due: NOW, priority: 1 }),
    ]
    expect(titles(laterTasks(tasks, NOW))).toEqual(['near-normal', 'far-high'])
  })
})

describe('backlogTasks', () => {
  it('is dateless only, high priority first', () => {
    const tasks = [
      task({ title: 'normal' }),
      task({ title: 'dated', due: NOW }),
      task({ title: 'high', priority: 1 }),
    ]
    expect(titles(backlogTasks(tasks))).toEqual(['high', 'normal'])
  })
})

describe('every view', () => {
  const noise = [
    task({ title: 'subtask', parent: 'parent-id', due: NOW }),
    task({ title: 'done', status: 'completed', due: NOW }),
    task({ title: 'deleted', isDeleted: 1, due: NOW }),
  ]

  it('hides subtasks, completed and locally deleted rows', () => {
    const withDated = [...noise, task({ title: 'kept', due: NOW })]
    expect(titles(todayTasks(withDated, NOW))).toEqual(['kept'])

    const withFuture = [
      ...noise.map((t) => ({ ...t, due: floatingDate('2026-09-01') })),
      task({ title: 'kept', due: floatingDate('2026-09-01') }),
    ]
    expect(titles(laterTasks(withFuture, NOW))).toEqual(['kept'])

    const withDateless = [...noise.map((t) => ({ ...t, due: null })), task({ title: 'kept' })]
    expect(titles(backlogTasks(withDateless))).toEqual(['kept'])
  })
})

describe('completedTasks', () => {
  it('is completed-only, newest first', () => {
    const tasks = [
      task({ title: 'open' }),
      task({ title: 'older', status: 'completed', completedAt: '2026-08-10T09:00:00.000Z' }),
      task({ title: 'newer', status: 'completed', completedAt: '2026-08-12T09:00:00.000Z' }),
    ]
    expect(titles(completedTasks(tasks))).toEqual(['newer', 'older'])
  })

  it('sorts tasks with no completion time last, not first', () => {
    // Completed in Google's app before this one existed, so no timestamp.
    const tasks = [
      task({ title: 'untimed', status: 'completed', completedAt: null }),
      task({ title: 'timed', status: 'completed', completedAt: '2026-08-10T09:00:00.000Z' }),
    ]
    expect(titles(completedTasks(tasks))).toEqual(['timed', 'untimed'])
  })

  it('hides subtasks and locally deleted rows', () => {
    const tasks = [
      task({ title: 'kept', status: 'completed', completedAt: '2026-08-10T09:00:00.000Z' }),
      task({ title: 'subtask', status: 'completed', parent: 'p', completedAt: '2026-08-11T09:00:00.000Z' }),
      task({ title: 'gone', status: 'completed', isDeleted: 1, completedAt: '2026-08-12T09:00:00.000Z' }),
    ]
    expect(titles(completedTasks(tasks))).toEqual(['kept'])
  })

  it('caps the list, keeping the most recent', () => {
    const tasks = Array.from({ length: 5 }, (_, index) =>
      task({
        title: `task-${index}`,
        status: 'completed',
        completedAt: `2026-08-1${index}T09:00:00.000Z`,
      }),
    )
    expect(titles(completedTasks(tasks, 2))).toEqual(['task-4', 'task-3'])
  })
})

describe('tasksForView', () => {
  it('dispatches every view, Done included', () => {
    const tasks = [
      task({ title: 'today', due: NOW }),
      task({ title: 'later', due: floatingDate('2026-09-01') }),
      task({ title: 'backlog' }),
      task({ title: 'done', status: 'completed', completedAt: '2026-08-12T09:00:00.000Z' }),
    ]

    expect(titles(tasksForView('today', tasks, NOW))).toEqual(['today'])
    expect(titles(tasksForView('later', tasks, NOW))).toEqual(['later'])
    expect(titles(tasksForView('backlog', tasks, NOW))).toEqual(['backlog'])
    expect(titles(tasksForView('done', tasks, NOW))).toEqual(['done'])
  })
})

describe('checklistProgress', () => {
  const tasks = [
    task({ title: 'shop', id: 'shop' }),
    task({ title: 'a', parent: 'shop', status: 'completed' }),
    task({ title: 'b', parent: 'shop' }),
    task({ title: 'gone', parent: 'shop', isDeleted: 1 }),
    task({ title: 'lonely', id: 'lonely' }),
  ]

  it('counts only live children', () => {
    expect(checklistProgress(tasks, 'shop')).toEqual({ done: 1, total: 2 })
  })

  it('is null when there is no checklist, so no badge renders', () => {
    expect(checklistProgress(tasks, 'lonely')).toBeNull()
  })
})

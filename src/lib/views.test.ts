import { describe, expect, it } from 'vitest'
import type { Task } from '@/db/db'
import { floatingDate } from '@/lib/dates'
import { backlogTasks, checklistProgress, laterTasks, todayTasks } from './views'

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

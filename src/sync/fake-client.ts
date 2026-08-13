import {
  TasksApiError,
  type GoogleTask,
  type GoogleTaskList,
  type ListTasksOptions,
  type TasksClient,
  type TaskWrite,
} from '@/sync/google-tasks'

/**
 * An in-memory stand-in for Google Tasks, used only by tests.
 *
 * It models the parts of the API the sync engine actually depends on: server
 * assigned ids and `updated` stamps, `updatedMin` filtering, and tombstones for
 * deletions. The clock is manual so tests can put changes on either side of a
 * watermark deliberately rather than by timing.
 */
export class FakeTasksClient implements TasksClient {
  lists: GoogleTaskList[] = []
  tasks: (GoogleTask & { listId: string })[] = []

  /** Every write stamps this, then advances it. */
  clock = Date.parse('2026-08-13T09:00:00.000Z')

  /** Recorded for assertions about incremental vs full pulls. */
  readonly listTasksCalls: { listId: string; updatedMin?: string }[] = []

  private nextId = 1

  private stamp(): string {
    this.clock += 1000
    return new Date(this.clock).toISOString()
  }

  /* --- test helpers ------------------------------------------------------- */

  addList(title: string, id = `list-${this.nextId++}`): GoogleTaskList {
    const list: GoogleTaskList = { id, title, updated: this.stamp() }
    this.lists.push(list)
    return list
  }

  /** Seed a task as though it already existed on the server. */
  addTask(listId: string, task: Partial<GoogleTask> & { title: string }): GoogleTask {
    const created: GoogleTask & { listId: string } = {
      id: `task-${this.nextId++}`,
      status: 'needsAction',
      updated: this.stamp(),
      ...task,
      listId,
    }
    this.tasks.push(created)
    return created
  }

  /** Edit server-side, the way another client would. */
  touch(taskId: string, changes: Partial<GoogleTask>): void {
    const task = this.find(taskId)
    Object.assign(task, changes, { updated: this.stamp() })
  }

  /** Delete server-side, leaving the tombstone a real pull would return. */
  remove(taskId: string): void {
    const task = this.find(taskId)
    task.deleted = true
    task.updated = this.stamp()
  }

  private find(taskId: string): GoogleTask & { listId: string } {
    const task = this.tasks.find((candidate) => candidate.id === taskId)
    if (!task) throw new Error(`No such task: ${taskId}`)
    return task
  }

  /** Writes to a task that is gone or tombstoned 404, as the real API does. */
  private findWritable(taskId: string): GoogleTask & { listId: string } {
    const task = this.tasks.find((candidate) => candidate.id === taskId)
    if (!task || task.deleted) {
      throw new TasksApiError(404, `No such task: ${taskId}`)
    }
    return task
  }

  /* --- TasksClient -------------------------------------------------------- */

  async listTaskLists(): Promise<GoogleTaskList[]> {
    return this.lists.map((list) => ({ ...list }))
  }

  async listTasks(listId: string, options: ListTasksOptions = {}): Promise<GoogleTask[]> {
    this.listTasksCalls.push({ listId, updatedMin: options.updatedMin })

    const since = options.updatedMin ? Date.parse(options.updatedMin) : null
    return this.tasks
      .filter((task) => task.listId === listId)
      .filter((task) => since === null || Date.parse(task.updated) >= since)
      .map(({ listId: _listId, ...task }) => ({ ...task }))
  }

  async insertTask(
    listId: string,
    task: TaskWrite,
    options: { parent?: string } = {},
  ): Promise<GoogleTask> {
    const created: GoogleTask & { listId: string } = {
      id: `task-${this.nextId++}`,
      title: task.title,
      notes: task.notes,
      status: task.status,
      updated: this.stamp(),
      listId,
      ...(task.due ? { due: task.due } : {}),
      ...(task.completed ? { completed: task.completed } : {}),
      ...(options.parent ? { parent: options.parent } : {}),
    }
    this.tasks.push(created)
    const { listId: _listId, ...result } = created
    return { ...result }
  }

  async patchTask(_listId: string, taskId: string, task: TaskWrite): Promise<GoogleTask> {
    const existing = this.findWritable(taskId)
    existing.title = task.title
    existing.notes = task.notes
    existing.status = task.status
    // The API drops these fields rather than storing null.
    if (task.due) existing.due = task.due
    else delete existing.due
    if (task.completed) existing.completed = task.completed
    else delete existing.completed
    existing.updated = this.stamp()

    const { listId: _listId2, ...result } = existing
    return { ...result }
  }

  async deleteTask(_listId: string, taskId: string): Promise<void> {
    const task = this.findWritable(taskId)
    task.deleted = true
    task.updated = this.stamp()
  }
}

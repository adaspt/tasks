/**
 * The Google Tasks REST surface, narrowed to what this app uses.
 *
 * Everything goes through the `TasksClient` interface so the sync engine can
 * be driven by a fake in tests. Nothing here knows about Dexie or about the
 * app's own conventions — `!` prefixes and floating dates are the sync layer's
 * business, not this one's.
 */

const BASE = 'https://tasks.googleapis.com/tasks/v1'

/** A task list as the API returns it. */
export interface GoogleTaskList {
  id: string
  title: string
  updated: string
}

/** A task as the API returns it. Most fields are absent rather than null. */
export interface GoogleTask {
  id: string
  title?: string
  notes?: string
  status?: 'needsAction' | 'completed'
  due?: string
  completed?: string
  parent?: string
  /** Only present on tombstones, which arrive when showDeleted is set. */
  deleted?: boolean
  /** Completed *and* cleared from the list. Still a real task. */
  hidden?: boolean
  updated: string
}

/** The writable subset of a task. */
export interface TaskWrite {
  title: string
  notes: string
  /** RFC 3339, or null to clear. The API discards the time portion. */
  due: string | null
  status: 'needsAction' | 'completed'
  completed: string | null
}

export interface ListTasksOptions {
  /** Only tasks changed since this timestamp. Omit for a full pull. */
  updatedMin?: string
}

export interface TasksClient {
  listTaskLists(): Promise<GoogleTaskList[]>
  listTasks(listId: string, options?: ListTasksOptions): Promise<GoogleTask[]>
  insertTask(listId: string, task: TaskWrite, options?: { parent?: string }): Promise<GoogleTask>
  patchTask(listId: string, taskId: string, task: TaskWrite): Promise<GoogleTask>
  deleteTask(listId: string, taskId: string): Promise<void>
}

export class TasksApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'TasksApiError'
    this.status = status
  }
}

/**
 * The real client. Takes a token getter rather than a token, so a sync that
 * outlives an access token can still refresh mid-flight.
 */
export function createTasksClient(getToken: () => Promise<string>): TasksClient {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T | null> {
    const token = await getToken()
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      throw new TasksApiError(response.status, `${init.method ?? 'GET'} ${path} failed`)
    }
    // DELETE returns an empty body.
    if (response.status === 204) return null
    const text = await response.text()
    return text ? (JSON.parse(text) as T) : null
  }

  /** Walks `nextPageToken`; the default page size is 20 and the max is 100. */
  async function requestAllPages<T>(path: string, query: URLSearchParams): Promise<T[]> {
    const items: T[] = []
    let pageToken: string | undefined

    do {
      const page = new URLSearchParams(query)
      page.set('maxResults', '100')
      if (pageToken) page.set('pageToken', pageToken)

      const result = await request<{ items?: T[]; nextPageToken?: string }>(`${path}?${page}`)
      if (result?.items) items.push(...result.items)
      pageToken = result?.nextPageToken
    } while (pageToken)

    return items
  }

  return {
    listTaskLists() {
      return requestAllPages<GoogleTaskList>('/users/@me/lists', new URLSearchParams())
    },

    listTasks(listId, options = {}) {
      const query = new URLSearchParams({
        // Tombstones, so deletions propagate. Completed-and-cleared tasks are
        // "hidden" rather than gone, and vanish confusingly without showHidden.
        showDeleted: 'true',
        showHidden: 'true',
        showCompleted: 'true',
      })
      if (options.updatedMin) query.set('updatedMin', options.updatedMin)
      return requestAllPages<GoogleTask>(`/lists/${listId}/tasks`, query)
    },

    async insertTask(listId, task, options = {}) {
      const query = new URLSearchParams()
      if (options.parent) query.set('parent', options.parent)
      const created = await request<GoogleTask>(`/lists/${listId}/tasks?${query}`, {
        method: 'POST',
        body: JSON.stringify(task),
      })
      if (!created) throw new TasksApiError(500, 'insert returned no task')
      return created
    },

    async patchTask(listId, taskId, task) {
      const patched = await request<GoogleTask>(`/lists/${listId}/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify(task),
      })
      if (!patched) throw new TasksApiError(500, 'patch returned no task')
      return patched
    },

    async deleteTask(listId, taskId) {
      await request(`/lists/${listId}/tasks/${taskId}`, { method: 'DELETE' })
    },
  }
}

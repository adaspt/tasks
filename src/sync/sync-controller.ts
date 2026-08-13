import { AuthError, canSyncNow, getAccessToken } from '@/auth/google-auth'
import { createTasksClient } from '@/sync/google-tasks'
import { sync } from '@/sync/sync'

/**
 * Decides *when* to sync, and holds the status the UI shows. The engine in
 * sync.ts decides what a sync does; this file is only scheduling.
 *
 * There is no background sync. Notifications come from Google's own app, so
 * this one only needs correct data while it is open — which removes a whole
 * category of service worker complexity for nothing lost.
 */

export type SyncPhase =
  | 'idle'
  | 'syncing'
  /** No token and one can't be had silently: the app still works, offline. */
  | 'signed-out'
  | 'error'

export interface SyncStatus {
  phase: SyncPhase
  lastSyncedAt: number | null
  message: string | null
}

let status: SyncStatus = { phase: 'idle', lastSyncedAt: null, message: null }
const listeners = new Set<() => void>()

function setStatus(next: Partial<SyncStatus>) {
  status = { ...status, ...next }
  for (const listener of listeners) listener()
}

export function subscribeToSyncStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSyncStatus(): SyncStatus {
  return status
}

/* --- running -------------------------------------------------------------- */

let running: Promise<void> | null = null
let lastAttemptAt = 0

/**
 * Runs a sync, or joins the one already in flight. Never throws: a failed sync
 * is a status, not an exception — every caller is a background trigger with
 * nowhere sensible to report to.
 */
export function runSync(options: { force?: boolean } = {}): Promise<void> {
  if (running) return running

  lastAttemptAt = Date.now()

  const attempt = (async () => {
    try {
      // Checked up front so the UI never flickers through "syncing" on its way
      // to "not connected". No network call, just the cached token's expiry.
      if (!(await canSyncNow())) {
        setStatus({ phase: 'signed-out', message: null })
        return
      }

      setStatus({ phase: 'syncing', message: null })
      const result = await sync(createTasksClient(getAccessToken), options)

      setStatus({
        phase: result.failures.length > 0 ? 'error' : 'idle',
        lastSyncedAt: Date.now(),
        message:
          result.failures.length > 0
            ? `${result.failures.length} change${result.failures.length === 1 ? '' : 's'} not saved`
            : null,
      })
    } catch (error) {
      // A missing token is the ordinary offline case, not a failure worth
      // shouting about — the user keeps working and it syncs later.
      if (error instanceof AuthError) {
        setStatus({ phase: 'signed-out', message: null })
      } else {
        setStatus({
          phase: 'error',
          message: error instanceof Error ? error.message : 'Sync failed',
        })
      }
    }
  })()

  running = attempt
  void attempt.then(() => {
    if (running === attempt) running = null
  })

  return attempt
}

/** Sync unless one ran very recently. Used by the chatty triggers. */
export function maybeSync(minIntervalMs = 30_000): Promise<void> {
  if (Date.now() - lastAttemptAt < minIntervalMs) return Promise.resolve()
  return runSync()
}

/* --- scheduling ----------------------------------------------------------- */

let debounce: ReturnType<typeof setTimeout> | null = null

/**
 * Coalesces a burst of edits into one sync. Also the undo window: a change
 * undone within the delay never reaches Google at all.
 */
export function scheduleSync(delayMs = 3000): void {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => {
    debounce = null
    void runSync()
  }, delayMs)
}

const PERIODIC_INTERVAL_MS = 5 * 60 * 1000

/**
 * Wires the background triggers and syncs straight away. Returns a cleanup
 * function.
 *
 * The immediate sync is the important one: without it the app opens showing
 * whatever IndexedDB happened to hold, and nothing arrives until the interval
 * fires minutes later. That reads as the app being broken.
 */
export function startSyncTriggers(): () => void {
  void runSync()

  const onOnline = () => void runSync()
  const onVisibility = () => {
    if (document.visibilityState === 'visible') void maybeSync()
  }

  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisibility)
  const interval = setInterval(() => void maybeSync(60_000), PERIODIC_INTERVAL_MS)

  return () => {
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisibility)
    clearInterval(interval)
    if (debounce) clearTimeout(debounce)
    debounce = null
  }
}

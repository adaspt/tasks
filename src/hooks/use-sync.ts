import { useEffect, useSyncExternalStore } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, hasCompletedFirstSync } from '@/db/db'
import {
  getSyncStatus,
  scheduleSync,
  startSyncTriggers,
  subscribeToSyncStatus,
  type SyncStatus,
} from '@/sync/sync-controller'

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeToSyncStatus, getSyncStatus, getSyncStatus)
}

/** How many local changes are waiting to reach Google. */
export function usePendingCount(): number {
  return (
    useLiveQuery(
      () =>
        db.tasks
          .where('isDirty')
          .equals(1)
          .count()
          .then((dirty) => db.tasks.where('isDeleted').equals(1).count().then((d) => dirty + d)),
      [],
    ) ?? 0
  )
}

export type SyncAlert = {
  message: string
  action: string
  signedOut: boolean
}

/**
 * Whether anything is wrong, separated from the banner that says so.
 *
 * The bottom bar has to know whether a banner is coming before it draws its own
 * border, or Done — which has no add row — would show an empty bordered strip
 * whenever sync is healthy.
 *
 * Only signed-out and failed states count. Ordinary pending changes are not
 * announced: they clear within seconds of an edit, and a banner that flashed on
 * every keystroke would train you to ignore it, which is exactly the opposite
 * of the point.
 */
export function useSyncAlert(): SyncAlert | null {
  const status = useSyncStatus()
  const pending = usePendingCount()

  if (status.phase !== 'signed-out' && status.phase !== 'error') return null

  const signedOut = status.phase === 'signed-out'

  // The unsynced count is folded into the signed-out message rather than being
  // its own state, because the count is what raises the stakes: "not connected"
  // is a shrug, "not connected, three changes unsaved" is not.
  const message = signedOut
    ? pending > 0
      ? `Not connected — ${pending} change${pending === 1 ? '' : 's'} not saved`
      : 'Not connected'
    : (status.message ?? 'Sync failed')

  return { message, action: signedOut ? 'Connect' : 'Retry', signedOut }
}

/**
 * Mounts the background triggers, and pushes whenever local changes appear.
 *
 * Watching the dirty count rather than calling scheduleSync() from each
 * mutation keeps the db layer unaware of syncing: any code path that dirties a
 * row gets a push, including ones written later that forget to ask for one.
 */
export function useSyncEngine(): void {
  const pending = usePendingCount()

  // Nothing may sync before the first sign-in has happened. A background
  // trigger with no prior grant asks GIS for a token outside a user gesture,
  // which means a blocked popup — on an interval, forever.
  const ready = useLiveQuery(() => hasCompletedFirstSync(), [], false)

  useEffect(() => {
    if (!ready) return
    return startSyncTriggers()
  }, [ready])

  useEffect(() => {
    if (ready && pending > 0) scheduleSync()
  }, [ready, pending])
}

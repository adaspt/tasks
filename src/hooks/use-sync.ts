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

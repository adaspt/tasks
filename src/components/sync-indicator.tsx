import { RefreshCw } from 'lucide-react'
import { useSyncStatus } from '@/hooks/use-sync'
import { reconnect } from '@/sync/sync-controller'

/**
 * A manual sync, and a hint that one is running. Nothing more: anything that
 * needs attention is the banner's job, and duplicating it here would put the
 * same message in two places at once.
 *
 * It is always present so a sync can always be forced — without that, a stalled
 * sync is indistinguishable from having nothing new.
 */
export function SyncIndicator() {
  const status = useSyncStatus()

  return (
    <button
      type="button"
      onClick={() => void reconnect()}
      aria-label="Sync now"
      className="-m-2 p-2 text-muted-foreground"
    >
      <RefreshCw className={status.phase === 'syncing' ? 'size-4 animate-spin' : 'size-4'} />
    </button>
  )
}

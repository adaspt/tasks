import { CloudOff, TriangleAlert } from 'lucide-react'
import { usePendingCount, useSyncStatus } from '@/hooks/use-sync'
import { reconnect } from '@/sync/sync-controller'

/**
 * Says, unmissably, when work is not reaching Google.
 *
 * Only appears when something is actually wrong — signed out, or a sync that
 * failed. Ordinary pending changes are not shown: they clear within seconds of
 * an edit, and a banner that flashed on every keystroke would train you to
 * ignore it, which is exactly the opposite of the point.
 *
 * The unsynced count is folded into the signed-out message rather than being
 * its own state, because the count is what raises the stakes: "not connected"
 * is a shrug, "not connected, three changes unsaved" is not.
 */
export function SyncBanner() {
  const status = useSyncStatus()
  const pending = usePendingCount()

  if (status.phase !== 'signed-out' && status.phase !== 'error') return null

  const signedOut = status.phase === 'signed-out'
  const Icon = signedOut ? CloudOff : TriangleAlert

  const message = signedOut
    ? pending > 0
      ? `Not connected — ${pending} change${pending === 1 ? '' : 's'} not saved`
      : 'Not connected'
    : (status.message ?? 'Sync failed')

  return (
    <button
      type="button"
      onClick={() => void reconnect()}
      className="mx-4 mb-3 flex items-center gap-3 rounded-lg border bg-muted px-3 py-2.5 text-left"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 text-sm">{message}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {signedOut ? 'Connect' : 'Retry'}
      </span>
    </button>
  )
}

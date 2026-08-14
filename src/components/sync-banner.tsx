import { CloudOff, TriangleAlert } from 'lucide-react'
import type { SyncAlert } from '@/hooks/use-sync'
import { reconnect } from '@/sync/sync-controller'

/**
 * Says, unmissably, when work is not reaching Google.
 *
 * It sits at the bottom of the screen, directly above the add row: the point of
 * the banner is that it gets tapped, and the bottom of a phone is where tapping
 * is cheap. Which states earn a banner is decided by useSyncAlert.
 */
export function SyncBanner({ alert }: { alert: SyncAlert }) {
  const Icon = alert.signedOut ? CloudOff : TriangleAlert

  return (
    <button
      type="button"
      onClick={() => void reconnect()}
      // The whole bar is the target — the label on the right names the action
      // rather than being the only thing you can hit.
      className="flex w-full items-center gap-3 bg-muted px-4 py-3 text-left transition-opacity active:opacity-60"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 text-sm">{alert.message}</span>
      <span className="shrink-0 text-xs font-medium text-muted-foreground">{alert.action}</span>
    </button>
  )
}

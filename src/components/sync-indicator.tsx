import type { ReactNode } from 'react'
import { CloudOff, RefreshCw, TriangleAlert } from 'lucide-react'
import { signIn } from '@/auth/google-auth'
import { usePendingCount, useSyncStatus } from '@/hooks/use-sync'
import { runSync } from '@/sync/sync-controller'

/**
 * Deliberately quiet: it says something when work is outstanding, and shows a
 * bare refresh icon otherwise. It is always present and always tappable, so
 * there is a way to force a sync even when everything looks fine — without
 * that, a stalled sync is indistinguishable from having nothing new.
 */
export function SyncIndicator() {
  const status = useSyncStatus()
  const pending = usePendingCount()

  const { icon, text }: { icon: ReactNode; text: string | null } = (() => {
    if (status.phase === 'syncing') {
      return { icon: <RefreshCw className="size-3.5 animate-spin" />, text: null }
    }
    if (status.phase === 'error') {
      return {
        icon: <TriangleAlert className="size-3.5" />,
        text: status.message ?? 'Sync failed',
      }
    }
    if (status.phase === 'signed-out') {
      return { icon: <CloudOff className="size-3.5" />, text: 'Not connected' }
    }
    if (pending > 0) {
      return { icon: <CloudOff className="size-3.5" />, text: `${pending} pending` }
    }
    return { icon: <RefreshCw className="size-3.5" />, text: null }
  })()

  /**
   * When signed out, ask for the token *first*. Browsers only allow the consent
   * popup while a user gesture is still live, and going through runSync would
   * spend that on the sync engine's own async work before GIS is ever reached.
   */
  async function reconnect() {
    if (status.phase === 'signed-out') {
      try {
        await signIn()
      } catch {
        return // the status already says what happened
      }
    }
    await runSync()
  }

  return (
    <button
      type="button"
      onClick={() => void reconnect()}
      aria-label="Sync now"
      className="-m-2 flex items-center gap-1.5 p-2 text-xs text-muted-foreground"
    >
      {icon}
      {text}
    </button>
  )
}

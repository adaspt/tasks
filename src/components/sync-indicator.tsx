import { CloudOff, RefreshCw, TriangleAlert } from 'lucide-react'
import { signIn } from '@/auth/google-auth'
import { usePendingCount, useSyncStatus } from '@/hooks/use-sync'
import { runSync } from '@/sync/sync-controller'

/**
 * Deliberately quiet. In an offline-first app the user needs to trust that
 * their edits are safe, so it says something when work is outstanding and
 * nothing at all when everything is where it should be.
 */
export function SyncIndicator() {
  const status = useSyncStatus()
  const pending = usePendingCount()

  if (status.phase === 'idle' && pending === 0) return null

  const content = () => {
    if (status.phase === 'syncing') {
      return { icon: <RefreshCw className="size-3.5 animate-spin" />, text: 'Syncing' }
    }
    if (status.phase === 'error') {
      return { icon: <TriangleAlert className="size-3.5" />, text: status.message ?? 'Sync failed' }
    }
    if (status.phase === 'signed-out') {
      return { icon: <CloudOff className="size-3.5" />, text: 'Not connected' }
    }
    return {
      icon: <CloudOff className="size-3.5" />,
      text: `${pending} pending`,
    }
  }

  const { icon, text } = content()

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
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      {icon}
      {text}
    </button>
  )
}

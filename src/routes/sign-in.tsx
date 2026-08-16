import { useEffect, useRef, useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { signIn } from '@/auth/google-auth'
import { hasCompletedFirstSync } from '@/db/db'
import { runSync } from '@/sync/sync-controller'

/** Where Google sends the browser back to once consent is done. */
const RETURN_TO = '/sign-in?connected=1'

export const Route = createFileRoute('/sign-in')({
  // Absent rather than false when unset, so every other route can still link
  // to /sign-in without being made to supply a search param.
  validateSearch: (search: Record<string, unknown>): { connected?: true } =>
    search.connected === '1' ? { connected: true } : {},
  beforeLoad: async () => {
    // Already synced once: never show this again, even with no valid token.
    if (await hasCompletedFirstSync()) {
      throw redirect({ to: '/today' })
    }
  },
  component: SignIn,
})

function SignIn() {
  const router = useRouter()
  const { connected } = Route.useSearch()
  const [busy, setBusy] = useState(connected === true)
  const [error, setError] = useState<string | null>(null)

  /**
   * Pulls down the lists once the server holds a refresh token. Split from the
   * button because sign-in is now a round trip through Google: the page that
   * started it is gone, and this runs in the fresh one that comes back.
   */
  const firstSync = useRef(async () => {
    setBusy(true)
    setError(null)
    try {
      await runSync({ force: true })
      if (!(await hasCompletedFirstSync())) {
        throw new Error('Could not load your task lists')
      }
      await router.navigate({ to: '/today' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed')
      setBusy(false)
    }
  })

  const started = useRef(false)

  useEffect(() => {
    if (!connected || started.current) return
    started.current = true
    void firstSync.current()
  }, [connected])

  // Leaves the page entirely, so nothing may be sequenced after it.
  function connect() {
    setBusy(true)
    void signIn(RETURN_TO)
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-between px-6 py-16">
      <div className="flex flex-1 flex-col justify-center gap-4">
        <CheckCircle2 className="size-10" strokeWidth={1.5} />
        <h1 className="text-3xl font-semibold tracking-tight">Tasks</h1>
        <p className="text-muted-foreground">
          Your Google Tasks, in three views. Sign in once to pull down your lists —
          after that it works offline.
        </p>
      </div>

      <div className="space-y-3">
        <Button className="h-12 w-full" onClick={connect} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? 'Connecting' : 'Continue with Google'}
        </Button>

        {error && <p className="text-center text-sm text-destructive">{error}</p>}

        {import.meta.env.DEV && (
          <Button
            variant="outline"
            className="h-12 w-full"
            onClick={async () => {
              const { seedIfEmpty } = await import('@/db/seed')
              await seedIfEmpty()
              await router.invalidate()
              await router.navigate({ to: '/today' })
            }}
          >
            Use sample data
          </Button>
        )}
      </div>
    </div>
  )
}

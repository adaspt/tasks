import { useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { signIn } from '@/auth/google-auth'
import { hasCompletedFirstSync } from '@/db/db'
import { runSync } from '@/sync/sync-controller'

export const Route = createFileRoute('/sign-in')({
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function connect() {
    setBusy(true)
    setError(null)
    try {
      // Both must happen before the app is usable: a token alone gives no
      // lists, and a task cannot be created without a list to put it in.
      await signIn()
      await runSync({ force: true })

      if (!(await hasCompletedFirstSync())) {
        throw new Error('Could not load your task lists')
      }
      await router.navigate({ to: '/today' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
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
        <Button className="h-12 w-full" onClick={() => void connect()} disabled={busy}>
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

import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { hasCompletedFirstSync } from '@/db/db'

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
        {/* TODO: Google Identity Services token client, scope .../auth/tasks. */}
        <Button className="h-12 w-full" disabled>
          Continue with Google
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Not wired up yet — auth is the next milestone.
        </p>
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

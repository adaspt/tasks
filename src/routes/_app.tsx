import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { hasCompletedFirstSync } from '@/db/db'

/**
 * The first-run gate. Nothing can be done before the first sync: there are no
 * lists, and a task cannot be created without a list to put it in.
 *
 * It deliberately keys off *having completed a sync*, not off holding a valid
 * access token. Tokens last about an hour, so gating on one would throw the
 * user back to a sign-in screen every hour with a database full of their tasks
 * sitting right there.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: async () => {
    if (!(await hasCompletedFirstSync())) {
      throw redirect({ to: '/sign-in' })
    }
  },
  component: Outlet,
})

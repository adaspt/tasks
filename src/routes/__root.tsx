import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { BottomNav } from '@/components/bottom-nav'
import { ListFilterProvider } from '@/hooks/use-list-filter'
import { useSyncEngine } from '@/hooks/use-sync'

export const Route = createRootRoute({ component: RootLayout })

function RootLayout() {
  // The sign-in screen is the whole viewport: no nav, nowhere to go yet.
  const isSignIn = useRouterState({
    select: (state) => state.location.pathname === '/sign-in',
  })

  useSyncEngine()

  return (
    <ListFilterProvider>
      {/* Fixed viewport height with the scroll inside <main>, so a view can
          stick something to the bottom of the list without it landing on top
          of the nav. */}
      <div className="flex h-dvh flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto overscroll-contain">
          <Outlet />
        </main>
        {!isSignIn && <BottomNav />}
      </div>
    </ListFilterProvider>
  )
}

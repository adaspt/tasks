import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { BottomNav } from '@/components/bottom-nav'
import { ListFilterProvider } from '@/hooks/use-list-filter'

export const Route = createRootRoute({ component: RootLayout })

function RootLayout() {
  // The sign-in screen is the whole viewport: no nav, nowhere to go yet.
  const isSignIn = useRouterState({
    select: (state) => state.location.pathname === '/sign-in',
  })

  return (
    <ListFilterProvider>
      <div className="flex min-h-dvh flex-col">
        <main className="flex-1">
          <Outlet />
        </main>
        {!isSignIn && <BottomNav />}
      </div>
    </ListFilterProvider>
  )
}

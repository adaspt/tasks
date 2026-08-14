import { Link } from '@tanstack/react-router'
import { CalendarClock, CheckCheck, Inbox, Sun } from 'lucide-react'

/**
 * Its own list rather than deriving from ViewId: Done is a destination but not
 * a view — it has no start date rule and nothing can be added to it.
 */
const TABS = [
  { to: '/today', label: 'Today', icon: Sun },
  { to: '/later', label: 'Later', icon: CalendarClock },
  { to: '/backlog', label: 'Backlog', icon: Inbox },
  { to: '/done', label: 'Done', icon: CheckCheck },
] as const

export function BottomNav() {
  return (
    <nav
      className="sticky bottom-0 border-t bg-background/95 backdrop-blur"
      // Keeps the bar clear of Android's gesture pill in standalone mode.
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-lg">
        {TABS.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex-1">
            <Link
              to={to}
              className="flex min-h-14 flex-col items-center justify-center gap-1 text-muted-foreground transition-colors"
              activeProps={{ className: 'text-foreground' }}
            >
              <Icon className="size-5" />
              <span className="text-xs font-medium">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

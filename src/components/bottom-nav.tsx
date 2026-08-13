import { Link } from '@tanstack/react-router'
import { CalendarClock, Inbox, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ViewId } from '@/lib/views'

const TABS: { id: ViewId; label: string; icon: typeof Sun }[] = [
  { id: 'today', label: 'Today', icon: Sun },
  { id: 'later', label: 'Later', icon: CalendarClock },
  { id: 'backlog', label: 'Backlog', icon: Inbox },
]

export function BottomNav() {
  return (
    <nav
      className="sticky bottom-0 border-t bg-background/95 backdrop-blur"
      // Keeps the bar clear of Android's gesture pill in standalone mode.
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-lg">
        {TABS.map(({ id, label, icon: Icon }) => (
          <li key={id} className="flex-1">
            <Link
              to={`/${id}`}
              className="flex min-h-14 flex-col items-center justify-center gap-1 text-muted-foreground transition-colors"
              activeProps={{ className: 'text-foreground' }}
            >
              {({ isActive }) => (
                <>
                  <Icon className={cn('size-5', isActive && 'fill-current/10')} />
                  <span className="text-xs font-medium">{label}</span>
                </>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

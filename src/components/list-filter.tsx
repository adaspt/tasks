import type { ReactNode } from 'react'
import { useLists } from '@/db/queries'
import { useListFilter } from '@/hooks/use-list-filter'
import { cn } from '@/lib/utils'

export function ListFilterBar() {
  const { listId, setListId } = useListFilter()
  const lists = useLists()

  // Nothing to filter by until there is more than one list.
  if (!lists || lists.length < 2) return null

  return (
    <div className="flex gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none]">
      <Chip active={listId === null} onClick={() => setListId(null)}>
        All
      </Chip>
      {lists.map((list) => (
        <Chip
          key={list.id}
          active={listId === list.id}
          onClick={() => setListId(listId === list.id ? null : list.id)}
        >
          {list.title}
        </Chip>
      ))}
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap transition-colors',
        active ? 'border-foreground bg-foreground text-background' : 'text-muted-foreground',
      )}
    >
      {children}
    </button>
  )
}

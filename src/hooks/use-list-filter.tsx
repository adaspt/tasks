import { createContext, use, useMemo, useState, type ReactNode } from 'react'

/**
 * The list filter is shared across all three views rather than living in each
 * route, so switching tabs keeps the current filter.
 */
const ListFilterContext = createContext<{
  listId: string | null
  setListId: (id: string | null) => void
}>({ listId: null, setListId: () => {} })

export function ListFilterProvider({ children }: { children: ReactNode }) {
  const [listId, setListId] = useState<string | null>(null)
  const value = useMemo(() => ({ listId, setListId }), [listId])
  return <ListFilterContext value={value}>{children}</ListFilterContext>
}

export function useListFilter() {
  return use(ListFilterContext)
}

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useLists } from '@/db/queries'
import { createTask } from '@/db/queries'
import { useListFilter } from '@/hooks/use-list-filter'
import { addDays, today, type FloatingDate } from '@/lib/dates'
import { parseTitle } from '@/lib/title'
import type { AddableViewId } from '@/lib/views'

/**
 * The view decides the start date, which removes the date picker from the
 * common case entirely: things added to Today are for today, things added to
 * Backlog have no date by definition.
 */
function defaultDue(view: AddableViewId): FloatingDate | null {
  switch (view) {
    case 'today':
      return today()
    case 'later':
      return addDays(today(), 1)
    case 'backlog':
      return null
  }
}

export function QuickAdd({ view }: { view: AddableViewId }) {
  const [value, setValue] = useState('')
  const { listId } = useListFilter()
  const lists = useLists()

  // Whichever list is filtered, else Google's default list (which sorts first).
  // There is no setting for this: filtering to a list and adding to it is the
  // obvious behaviour.
  const target = listId ? lists?.find((list) => list.id === listId) : lists?.[0]
  const targetList = target?.id

  // Name the destination whenever there is a choice to get wrong. Without it, a
  // task can land in a list you are not looking at with nothing to say so.
  const placeholder =
    lists && lists.length > 1 && target ? `Add to ${target.title}` : 'Add a task'

  async function submit() {
    const raw = value.trim()
    if (!raw || !targetList) return

    // `!` works here exactly as it does in Google's app and in the sheet.
    const { title, priority } = parseTitle(raw)
    if (!title) return

    setValue('')
    await createTask({ listId: targetList, title, priority, due: defaultDue(view) })
  }

  return (
    <form
      className="sticky bottom-0 border-t bg-background/95 px-4 py-2 backdrop-blur"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="flex items-center gap-2">
        <Plus className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          aria-label="Add a task"
          enterKeyHint="done"
          className="min-h-10 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
        />
      </div>
    </form>
  )
}

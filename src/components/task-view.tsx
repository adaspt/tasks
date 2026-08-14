import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { History } from 'lucide-react'
import { ListFilterBar } from '@/components/list-filter'
import { QuickAdd } from '@/components/quick-add'
import { SyncIndicator } from '@/components/sync-indicator'
import { TaskRow } from '@/components/task-row'
import { TaskSheet } from '@/components/task-sheet'
import { useTasks } from '@/db/queries'
import { useListFilter } from '@/hooks/use-list-filter'
import { checklistProgress, tasksForView, type ViewId } from '@/lib/views'

const EMPTY: Record<ViewId, string> = {
  today: 'Nothing due today.',
  later: 'Nothing scheduled ahead.',
  backlog: 'Backlog is empty.',
}

export function TaskView({ view, title }: { view: ViewId; title: string }) {
  const allTasks = useTasks()
  const { listId } = useListFilter()
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)

  // Undefined means Dexie has not answered yet; rendering nothing beats a
  // flash of "empty" on every load.
  if (!allTasks) return null

  const scoped = listId ? allTasks.filter((task) => task.listId === listId) : allTasks
  const tasks = tasksForView(view, scoped)

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col">
      <header className="flex items-center justify-between gap-3 px-4 pt-6 pb-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <div className="flex items-center gap-3">
          {/* Undo lives off Backlog rather than in the nav: it is a place you
              go occasionally to fix a mistake, not a fourth view. */}
          {view === 'backlog' && (
            <Link
              to="/done"
              aria-label="Completed tasks"
              className="-m-2 p-2 text-muted-foreground"
            >
              <History className="size-4" />
            </Link>
          )}
          <SyncIndicator />
        </div>
      </header>

      <ListFilterBar />

      <div className="flex-1">
        {tasks.length === 0 ? (
          <p className="px-4 py-16 text-center text-sm text-muted-foreground">{EMPTY[view]}</p>
        ) : (
          <ul>
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                checklist={checklistProgress(allTasks, task.id)}
                showDate={view !== 'backlog'}
                onOpen={() => setOpenTaskId(task.id)}
              />
            ))}
          </ul>
        )}
      </div>

      <QuickAdd view={view} />

      <TaskSheet taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
    </div>
  )
}

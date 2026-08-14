import { useState } from 'react'
import { CompletedRow } from '@/components/completed-row'
import { ListFilterBar } from '@/components/list-filter'
import { QuickAdd } from '@/components/quick-add'
import { SyncBanner } from '@/components/sync-banner'
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
  done: 'Nothing completed yet.',
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
        <SyncIndicator />
      </header>

      <SyncBanner />

      <ListFilterBar />

      <div className="flex-1">
        {tasks.length === 0 ? (
          <p className="px-4 py-16 text-center text-sm text-muted-foreground">{EMPTY[view]}</p>
        ) : (
          <ul>
            {tasks.map((task) =>
              view === 'done' ? (
                <CompletedRow key={task.id} task={task} />
              ) : (
                <TaskRow
                  key={task.id}
                  task={task}
                  checklist={checklistProgress(allTasks, task.id)}
                  showDate={view !== 'backlog'}
                  onOpen={() => setOpenTaskId(task.id)}
                />
              ),
            )}
          </ul>
        )}
      </div>

      {/* Narrowing here is what makes QuickAdd's AddableViewId typecheck: there
          is no such thing as adding a task to Done. */}
      {view !== 'done' && <QuickAdd view={view} />}

      <TaskSheet taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
    </div>
  )
}

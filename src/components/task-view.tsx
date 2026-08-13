import { ListFilterBar } from '@/components/list-filter'
import { SyncIndicator } from '@/components/sync-indicator'
import { TaskRow } from '@/components/task-row'
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

  // Undefined means Dexie has not answered yet; rendering nothing beats a
  // flash of "empty" on every load.
  if (!allTasks) return null

  const scoped = listId ? allTasks.filter((task) => task.listId === listId) : allTasks
  const tasks = tasksForView(view, scoped)

  return (
    <div className="mx-auto max-w-lg">
      <header className="flex items-center justify-between gap-3 px-4 pt-6 pb-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <SyncIndicator />
      </header>

      <ListFilterBar />

      {tasks.length === 0 ? (
        <p className="px-4 py-16 text-center text-sm text-muted-foreground">
          {EMPTY[view]}
        </p>
      ) : (
        <ul>
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              checklist={checklistProgress(allTasks, task.id)}
              showDate={view !== 'backlog'}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

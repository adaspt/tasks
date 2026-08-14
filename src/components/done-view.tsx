import { Link } from '@tanstack/react-router'
import { ArrowLeft, Undo2 } from 'lucide-react'
import { ListFilterBar } from '@/components/list-filter'
import { setTaskDone, useTasks } from '@/db/queries'
import { useListFilter } from '@/hooks/use-list-filter'
import { formatRelative, fromLocalDate, today } from '@/lib/dates'
import { completedTasks } from '@/lib/views'

/**
 * Completed tasks, newest first, so a mistake can be undone. Un-completing
 * restores the task's start date untouched, so it reappears in whichever view
 * it came from — Today if its date has passed, Backlog if it never had one.
 */
export function DoneView() {
  const allTasks = useTasks()
  const { listId } = useListFilter()

  if (!allTasks) return null

  const scoped = listId ? allTasks.filter((task) => task.listId === listId) : allTasks
  const tasks = completedTasks(scoped)
  const now = today()

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col">
      <header className="flex items-center gap-2 px-4 pt-6 pb-3">
        <Link
          to="/backlog"
          aria-label="Back"
          className="-m-2 p-2 text-muted-foreground"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Done</h1>
      </header>

      <ListFilterBar />

      {tasks.length === 0 ? (
        <p className="px-4 py-16 text-center text-sm text-muted-foreground">
          Nothing completed yet.
        </p>
      ) : (
        <ul>
          {tasks.map((task) => (
            <li key={task.id} className="flex items-start gap-3 border-b px-4">
              <div className="min-w-0 flex-1 py-3">
                <p className="text-[15px] leading-snug break-words text-muted-foreground line-through">
                  {task.title}
                </p>
                {task.completedAt && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {/* completedAt is a real instant, unlike a task's due date,
                        so it must be converted rather than string-sliced —
                        slicing yields the UTC day and is wrong after evening. */}
                    {formatRelative(fromLocalDate(new Date(task.completedAt)), now)}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => void setTaskDone(task.id, false)}
                aria-label={`Restore ${task.title}`}
                className="-m-2 mt-1 p-2 text-muted-foreground"
              >
                <Undo2 className="size-5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

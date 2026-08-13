import { Check, ListChecks } from 'lucide-react'
import type { Task } from '@/db/db'
import { setTaskDone } from '@/db/queries'
import { formatRelative, today } from '@/lib/dates'
import { cn } from '@/lib/utils'

export function TaskRow({
  task,
  checklist,
  showDate = true,
}: {
  task: Task
  checklist: { done: number; total: number } | null
  /** Backlog rows have no date to show. */
  showDate?: boolean
}) {
  const now = today()
  const isOverdue = task.due !== null && task.due < now

  return (
    <li className="flex items-start gap-3 border-b px-4 py-3">
      <button
        type="button"
        onClick={() => void setTaskDone(task.id, true)}
        aria-label={`Complete ${task.title}`}
        className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-transparent transition-colors active:bg-foreground active:text-background"
      >
        <Check className="size-4" />
      </button>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-[15px] leading-snug break-words',
            // Priority reads as weight, not colour: the only meaningful colour
            // in the app is the red on an overdue date.
            task.priority === 1 && 'font-semibold',
          )}
        >
          {task.title}
        </p>

        {(checklist || (showDate && task.due)) && (
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            {showDate && task.due && (
              <span className={cn(isOverdue && 'text-destructive')}>
                {formatRelative(task.due, now)}
              </span>
            )}
            {checklist && (
              <span className="flex items-center gap-1">
                <ListChecks className="size-3.5" />
                {checklist.done}/{checklist.total}
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

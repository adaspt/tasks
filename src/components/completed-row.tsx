import { Undo2 } from 'lucide-react'
import type { Task } from '@/db/db'
import { setTaskDone } from '@/db/queries'
import { formatRelative, fromLocalDate, today } from '@/lib/dates'

/**
 * A completed task in Done. Restoring leaves the start date untouched, so the
 * task returns to whichever view it came from.
 */
export function CompletedRow({ task }: { task: Task }) {
  return (
    <li className="flex items-start gap-3 border-b px-4">
      <div className="min-w-0 flex-1 py-3">
        <p className="text-[15px] leading-snug break-words text-muted-foreground line-through">
          {task.title}
        </p>
        {task.completedAt && (
          <p className="mt-1 text-xs text-muted-foreground">
            {/* completedAt is a real instant, unlike a task's due date, so it
                must be converted rather than string-sliced — slicing gives the
                UTC day and shows the wrong date after early evening. */}
            {formatRelative(fromLocalDate(new Date(task.completedAt)), today())}
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
  )
}

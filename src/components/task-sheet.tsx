import { useEffect, useState } from 'react'
import { Check, Plus, Trash2 } from 'lucide-react'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { Task } from '@/db/db'
import {
  createTask,
  deleteTask,
  setTaskDone,
  setTaskDue,
  setTaskPriority,
  updateTask,
  useTask,
  useTasks,
} from '@/db/queries'
import { addDays, formatRelative, today, type FloatingDate } from '@/lib/dates'
import { cn } from '@/lib/utils'

/**
 * Everything you can do to a task, in one place. Snooze is the reason it
 * exists — deferring something to tomorrow is the action this app is for, and
 * with start-date-only it is a single field write.
 *
 * Checklists live here too, because they are deliberately invisible in the
 * three views: opening the task is the only place they appear.
 */
export function TaskSheet({
  taskId,
  onClose,
}: {
  taskId: string | null
  onClose: () => void
}) {
  const task = useTask(taskId ?? undefined)

  return (
    <Drawer open={taskId !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="max-h-[85vh]">
        {task && <TaskSheetBody task={task} onClose={onClose} />}
      </DrawerContent>
    </Drawer>
  )
}

function TaskSheetBody({ task, onClose }: { task: Task; onClose: () => void }) {
  const allTasks = useTasks()
  const subtasks = (allTasks ?? [])
    .filter((candidate) => candidate.parent === task.id)
    .sort((a, b) => a.title.localeCompare(b.title))

  return (
    <div className="mx-auto w-full max-w-lg overflow-y-auto px-4 pb-8">
      <DrawerHeader className="px-0">
        <DrawerTitle className="sr-only">Edit task</DrawerTitle>
        <DrawerDescription className="sr-only">
          Change the start date, priority, notes and checklist.
        </DrawerDescription>
        <TitleField task={task} />
      </DrawerHeader>

      <Section label="Start date">
        <DateChips task={task} />
      </Section>

      <Section label="Priority">
        {/* No star icon: Google's star is deliberately *not* this, and the API
            cannot even see it. Showing one here would imply they are linked. */}
        <Chip
          active={task.priority === 1}
          onClick={() => void setTaskPriority(task.id, task.priority === 1 ? 0 : 1)}
        >
          High priority
        </Chip>
      </Section>

      <Section label="Notes">
        <NotesField task={task} />
      </Section>

      <Section label={`Checklist${subtasks.length ? ` (${subtasks.filter((s) => s.status === 'completed').length}/${subtasks.length})` : ''}`}>
        <Checklist parent={task} subtasks={subtasks} />
      </Section>

      <div className="mt-6 flex gap-2">
        <Button
          variant="outline"
          className="h-11 flex-1"
          onClick={() => {
            void setTaskDone(task.id, true)
            onClose()
          }}
        >
          <Check className="size-4" />
          Done
        </Button>
        <Button
          variant="ghost"
          className="h-11 text-destructive"
          onClick={() => {
            void deleteTask(task.id)
            onClose()
          }}
          aria-label="Delete task"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </h3>
      {children}
    </section>
  )
}

/** Committed on blur rather than per keystroke, so one edit is one sync. */
function TitleField({ task }: { task: Task }) {
  const [value, setValue] = useState(task.title)

  useEffect(() => setValue(task.title), [task.id, task.title])

  return (
    <input
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        const next = value.trim()
        if (next && next !== task.title) void updateTask(task.id, { title: next })
        else if (!next) setValue(task.title)
      }}
      aria-label="Task title"
      className="w-full bg-transparent text-lg font-medium outline-none"
    />
  )
}

function NotesField({ task }: { task: Task }) {
  const [value, setValue] = useState(task.notes)

  useEffect(() => setValue(task.notes), [task.id, task.notes])

  return (
    <Textarea
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        if (value !== task.notes) void updateTask(task.id, { notes: value })
      }}
      placeholder="Notes"
      rows={3}
      className="resize-none"
    />
  )
}

function DateChips({ task }: { task: Task }) {
  const now = today()
  const options: { label: string; value: FloatingDate | null }[] = [
    { label: 'Today', value: now },
    { label: 'Tomorrow', value: addDays(now, 1) },
    { label: 'Next week', value: addDays(now, 7) },
    { label: 'None', value: null },
  ]

  // A date already set that none of the shortcuts match — show it so the
  // current state is always visible, not just the shortcuts.
  const isCustom = task.due !== null && !options.some((option) => option.value === task.due)

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Chip
          key={option.label}
          active={task.due === option.value}
          onClick={() => void setTaskDue(task.id, option.value)}
        >
          {option.label}
        </Chip>
      ))}

      {isCustom && <Chip active>{formatRelative(task.due!, now)}</Chip>}

      <label className="relative">
        <Chip active={false}>Pick…</Chip>
        <input
          type="date"
          value={task.due ?? ''}
          onChange={(event) => {
            const next = event.target.value
            void setTaskDue(task.id, next ? (next as FloatingDate) : null)
          }}
          aria-label="Pick a start date"
          className="absolute inset-0 opacity-0"
        />
      </label>
    </div>
  )
}

function Checklist({ parent, subtasks }: { parent: Task; subtasks: Task[] }) {
  const [value, setValue] = useState('')

  return (
    <div className="space-y-1">
      {subtasks.map((subtask) => (
        <button
          key={subtask.id}
          type="button"
          onClick={() => void setTaskDone(subtask.id, subtask.status !== 'completed')}
          className="flex w-full items-center gap-3 py-1.5 text-left"
        >
          <span
            className={cn(
              'grid size-5 shrink-0 place-items-center rounded-full border',
              subtask.status === 'completed'
                ? 'bg-foreground text-background'
                : 'text-transparent',
            )}
          >
            <Check className="size-3" />
          </span>
          <span
            className={cn(
              'text-sm',
              subtask.status === 'completed' && 'text-muted-foreground line-through',
            )}
          >
            {subtask.title}
          </span>
        </button>
      ))}

      <form
        className="flex items-center gap-3 py-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          const title = value.trim()
          if (!title) return
          setValue('')
          void createTask({ listId: parent.listId, title, parent: parent.id })
        }}
      >
        <Plus className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Add an item"
          aria-label="Add a checklist item"
          className="min-h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </form>
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick?: () => void
  children: React.ReactNode
}) {
  const className = cn(
    'inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-sm whitespace-nowrap',
    active ? 'border-foreground bg-foreground text-background' : 'text-muted-foreground',
  )

  // Rendered as a span when inert — the date picker wraps one in a <label>,
  // where a nested button would swallow the click meant for the input.
  if (!onClick) return <span className={className}>{children}</span>

  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  )
}

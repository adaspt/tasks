import { createFileRoute } from '@tanstack/react-router'
import { TaskView } from '@/components/task-view'

export const Route = createFileRoute('/_app/done')({
  component: () => <TaskView view="done" title="Done" />,
})

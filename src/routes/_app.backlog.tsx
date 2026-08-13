import { createFileRoute } from '@tanstack/react-router'
import { TaskView } from '@/components/task-view'

export const Route = createFileRoute('/_app/backlog')({
  component: () => <TaskView view="backlog" title="Backlog" />,
})

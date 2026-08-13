import { createFileRoute } from '@tanstack/react-router'
import { TaskView } from '@/components/task-view'

export const Route = createFileRoute('/_app/today')({
  component: () => <TaskView view="today" title="Today" />,
})

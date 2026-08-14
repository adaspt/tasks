import { createFileRoute } from '@tanstack/react-router'
import { DoneView } from '@/components/done-view'

export const Route = createFileRoute('/_app/done')({
  component: DoneView,
})

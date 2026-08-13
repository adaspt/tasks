import { db, markFirstSyncComplete, newId, type Task } from '@/db/db'
import { addDays, today, type FloatingDate } from '@/lib/dates'

/**
 * Development-only fixture, so all three views can be built and looked at
 * before any Google API code exists. Never runs in a production build, and
 * never runs if there is already data.
 */
export async function seedIfEmpty(): Promise<void> {
  if (await db.lists.count()) return

  const now = today()
  const personal = newId()
  const work = newId()

  await db.lists.bulkAdd([
    { id: personal, remoteId: 'seed-personal', title: 'Personal', sortOrder: 0, updated: null, isDirty: 0, isDeleted: 0 },
    { id: work, remoteId: 'seed-work', title: 'Work', sortOrder: 1, updated: null, isDirty: 0, isDeleted: 0 },
  ])

  const shoppingId = newId()

  const task = (
    listId: string,
    title: string,
    priority: 0 | 1,
    due: FloatingDate | null,
    extra: Partial<Task> = {},
  ): Task => ({
    id: extra.id ?? newId(),
    remoteId: `seed-${title.toLowerCase().replace(/\W+/g, '-')}`,
    listId,
    title,
    priority,
    notes: '',
    due,
    status: 'needsAction',
    completedAt: null,
    parent: null,
    updated: null,
    isDirty: 0,
    isDeleted: 0,
    ...extra,
  })

  await db.tasks.bulkAdd([
    // Today — including two overdue, to exercise the red date.
    task(personal, 'Renew passport', 1, addDays(now, -18)),
    task(work, 'Reply to the auditors', 1, now),
    task(personal, 'Book dentist', 0, addDays(now, -3)),
    task(work, 'Review pull request', 0, now),
    task(personal, 'Weekly shop', 0, now, { id: shoppingId }),

    // Later
    task(work, 'Quarterly review prep', 1, addDays(now, 2)),
    task(personal, 'Car service', 0, addDays(now, 5)),
    task(personal, 'Mum’s birthday', 1, addDays(now, 12)),
    task(work, 'Renew domain', 0, addDays(now, 40)),

    // Backlog
    task(personal, 'Fix the shed door', 1, null),
    task(personal, 'Learn some Rust', 0, null),
    task(work, 'Write up the sync design', 0, null),
    task(personal, 'Sort out the loft', 0, null),

    // Checklist under "Weekly shop" — never shown in the views, only the badge.
    task(personal, 'Coffee', 0, null, { parent: shoppingId, status: 'completed' }),
    task(personal, 'Olive oil', 0, null, { parent: shoppingId, status: 'completed' }),
    task(personal, 'Bread', 0, null, { parent: shoppingId }),
    task(personal, 'Tomatoes', 0, null, { parent: shoppingId }),
  ])

  // Seeded data stands in for a completed sync, so the first-run gate opens.
  await markFirstSyncComplete()
}

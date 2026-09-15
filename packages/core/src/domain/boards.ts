import { boardSchema } from './entities.ts'
import { z } from 'zod'

export const boardDefaultSchema = z.strictObject({
  scope: z.enum(['application', 'role', 'group', 'user']),
  subject: z.string().min(1),
  boardId: z.uuid(),
})
export type BoardDefault = z.infer<typeof boardDefaultSchema>

export const boardDefaultAssignmentsSchema = z.strictObject({
  application: z.boolean(),
  roleKeys: z.array(z.string()).max(100),
  groupIds: z.array(z.uuid()).max(1000),
})
export const boardPreferenceSchema = z.strictObject({ boardId: z.uuid().nullable() })
export const boardCatalogSchema = z.strictObject({
  items: z.array(boardSchema),
  canManage: z.boolean(),
  preferredBoardId: z.uuid().nullable(),
  defaultBoardId: z.uuid().nullable(),
  defaultSource: z.enum(['personal', 'group', 'role', 'application', 'fallback']),
  /** Administrators see admin assignments only, never other users' preferences. */
  defaultAssignments: z.array(boardDefaultSchema),
})
export type BoardCatalog = z.infer<typeof boardCatalogSchema>

/** Board management uses the global managePolicy grant. Membership grants visibility only. */
export const boardInputSchema = boardSchema
  .pick({
    name: true,
    accessMode: true,
    allowedRoleKeys: true,
    allowedUserIds: true,
    allowedGroupIds: true,
  })
  .extend({ defaultAssignments: boardDefaultAssignmentsSchema.optional() })
export type BoardInput = z.infer<typeof boardInputSchema>

export const groupSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().trim().min(1).max(80),
  userIds: z.array(z.uuid()).max(1000),
  createdAt: z.iso.datetime(),
})
export type Group = z.infer<typeof groupSchema>
export const groupInputSchema = groupSchema.pick({ name: true, userIds: true })
export type GroupInput = z.infer<typeof groupInputSchema>

/** Starting columns for new boards and first boot. Admin changes are never reseeded. */
export const DEFAULT_LANES = [
  { key: 'intake', label: 'Intake', wipLimit: null },
  { key: 'waiting_approval', label: 'Waiting for Approval', wipLimit: null },
  { key: 'ready', label: 'Ready', wipLimit: null },
  { key: 'in_progress', label: 'In Progress', wipLimit: 5 },
  { key: 'waiting_parts_vendor', label: 'Waiting on Parts / Vendor', wipLimit: 8 },
  { key: 'review', label: 'Review', wipLimit: 5 },
  { key: 'done', label: 'Done', wipLimit: null },
] as const

import { ROLES } from '@rivian-kanban/core'
import { strings } from '../strings.ts'

/** Mantine Select data for every role picker (user row/create, token create). */
export const ROLE_SELECT_DATA = ROLES.map((role) => ({
  value: role,
  label: strings.users.roles[role],
}))

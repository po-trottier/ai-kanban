import { type PolicyDocument } from '@rivian-kanban/core'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { permissivePolicy } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { PolicyEditorForm } from './PolicyEditorForm.tsx'

const laneLabels = {
  intake: 'Intake',
  waiting_approval: 'Waiting for Approval',
  ready: 'Ready',
  in_progress: 'In Progress',
  waiting_parts_vendor: 'Waiting on Parts / Vendor',
  review: 'Review',
  done: 'Done',
}

function render(onSave: (document: PolicyDocument) => void = () => undefined) {
  renderWithProviders(
    <PolicyEditorForm
      value={permissivePolicy}
      laneLabels={laneLabels}
      saving={false}
      onSave={onSave}
    />,
  )
}

describe('PolicyEditorForm — roles × permissions matrix', () => {
  it('renders a checkbox per (role, permission) reflecting the grant map', () => {
    // Arrange
    const onSave = () => undefined

    // Act
    render(onSave)

    // Assert — the default user grants "Create cards", admin grants everything.
    const userCreate = screen.getByRole('checkbox', { name: 'Create cards for User' })
    const adminManageUsers = screen.getByRole('checkbox', {
      name: 'Manage users for Administrator',
    })
    const userManageUsers = screen.getByRole('checkbox', { name: 'Manage users for User' })
    expect(userCreate).toBeChecked()
    expect(adminManageUsers).toBeChecked()
    expect(userManageUsers).not.toBeChecked()
    // Enforcement is off by default.
    expect(screen.getByRole('switch', { name: /Enforce workflow transitions/ })).not.toBeChecked()
  })

  it('toggling a cell then saving PUTs the expected document', async () => {
    // Arrange
    const user = userEvent.setup()
    const saved: PolicyDocument[] = []
    render((document) => saved.push(document))

    // Act — grant the user role "Delete others’ comments", then save.
    await user.click(screen.getByRole('checkbox', { name: 'Delete others’ comments for User' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // Assert
    expect(saved).toHaveLength(1)
    const userRole = saved[0]?.roles.find((role) => role.key === 'user')
    expect(userRole?.permissions['comment.deleteOthers']).toBe(true)
    // Untouched grants stay put; admin still has everything.
    expect(userRole?.permissions['card.create']).toBe(true)
  })

  it('saves the enforcement toggle without touching the roles', async () => {
    // Arrange
    const user = userEvent.setup()
    const saved: PolicyDocument[] = []
    render((document) => saved.push(document))

    // Act
    await user.click(screen.getByRole('switch', { name: /Enforce workflow transitions/ }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // Assert
    expect(saved[0]?.transitionEnforcement).toBe(true)
    expect(saved[0]?.roles).toEqual(permissivePolicy.roles)
  })

  it('locks manageRoles on the last role that grants it', () => {
    // Arrange — admin is the only role with manageRoles in the seed.
    const onSave = () => undefined

    // Act
    render(onSave)

    // Assert — its manageRoles cell is disabled so it can never be unticked.
    const adminManageRoles = screen.getByRole('checkbox', {
      name: 'Manage roles & permissions for Administrator',
    })
    expect(adminManageRoles).toBeDisabled()
    expect(adminManageRoles).toBeChecked()
  })

  it('adds a new role via the Add role modal', async () => {
    // Arrange
    const user = userEvent.setup()
    const saved: PolicyDocument[] = []
    render((document) => saved.push(document))

    // Act
    await user.click(screen.getByRole('button', { name: 'Add role' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Key'), 'lead')
    await user.type(within(dialog).getByLabelText('Display name'), 'Team Lead')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // Assert — the new role appears as a column with an empty grant map.
    const lead = saved[0]?.roles.find((role) => role.key === 'lead')
    expect(lead).toEqual({ key: 'lead', name: 'Team Lead', permissions: {} })
  })
})

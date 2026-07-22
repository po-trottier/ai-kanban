import { type PolicyDocument } from '@rivian-kanban/core'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { permissivePolicy } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { PolicyEditorForm } from './PolicyEditorForm.tsx'

function render(onSave: (document: PolicyDocument) => void = () => undefined) {
  renderWithProviders(<PolicyEditorForm value={permissivePolicy} saving={false} onSave={onSave} />)
}

describe('PolicyEditorForm — roles × permissions matrix', () => {
  it('renders a checkbox per (role, permission) reflecting the grant map', () => {
    // Arrange
    const onSave = () => undefined

    // Act
    render(onSave)

    // Assert — the default user grants "Create work orders", admin grants everything.
    const userCreate = screen.getByRole('checkbox', { name: 'Create work orders for User' })
    const adminManageUsers = screen.getByRole('checkbox', {
      name: 'Manage users for Administrator',
    })
    const userManageUsers = screen.getByRole('checkbox', { name: 'Manage users for User' })
    expect(userCreate).toBeChecked()
    expect(adminManageUsers).toBeChecked()
    expect(userManageUsers).not.toBeChecked()
    // Workflow transitions moved to the Columns tab — no enforcement switch here.
    expect(screen.queryByRole('switch', { name: /Enforce/ })).not.toBeInTheDocument()
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

  it('carries the workflow transitions through a save untouched (edited on the Columns tab)', async () => {
    // Arrange — this form no longer edits transitions; a role-only save must
    // still PUT the loaded transitions + enforcement flag verbatim.
    const user = userEvent.setup()
    const saved: PolicyDocument[] = []
    render((document) => saved.push(document))

    // Act — flip one permission, then save.
    await user.click(screen.getByRole('checkbox', { name: 'Delete others’ comments for User' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // Assert
    expect(saved[0]?.transitions).toEqual(permissivePolicy.transitions)
    expect(saved[0]?.transitionEnforcement).toBe(permissivePolicy.transitionEnforcement)
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

  it('edits the business hours and PUTs them with the rest of the document', async () => {
    // Arrange — the seed working day is 9:00 AM–5:00 PM.
    const user = userEvent.setup()
    const saved: PolicyDocument[] = []
    render((document) => saved.push(document))
    expect(screen.getByRole('combobox', { name: 'Working day starts' })).toHaveValue('9:00 AM')
    expect(screen.getByRole('combobox', { name: 'Working day ends' })).toHaveValue('5:00 PM')

    // Act — shift to an 8:00 AM–6:00 PM day, then save.
    await user.click(screen.getByRole('combobox', { name: 'Working day starts' }))
    await user.click(await screen.findByRole('option', { name: '8:00 AM' }))
    await user.click(screen.getByRole('combobox', { name: 'Working day ends' }))
    await user.click(await screen.findByRole('option', { name: '6:00 PM' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // Assert
    expect(saved[0]?.businessHours).toEqual({ startHour: 8, endHour: 18 })
  })

  it('no longer renders the workflow-transitions matrix (moved to Columns)', () => {
    // Arrange
    const onSave = () => undefined

    // Act
    render(onSave)

    // Assert — no from×to edge control lives on this Permissions form now.
    expect(
      screen.queryByRole('checkbox', { name: 'Allow move from Intake to Ready' }),
    ).not.toBeInTheDocument()
  })
})

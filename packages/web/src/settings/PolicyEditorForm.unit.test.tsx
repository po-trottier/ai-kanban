import { type PolicyDocument } from '@rivian-kanban/core'
import { screen } from '@testing-library/react'
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

describe('PolicyEditorForm', () => {
  it('renders the seeded graph with its suggested role gates', () => {
    // Arrange
    const policy = permissivePolicy
    // Act
    renderWithProviders(
      <PolicyEditorForm
        value={policy}
        laneLabels={laneLabels}
        saving={false}
        onSave={() => undefined}
      />,
    )
    // Assert
    expect(screen.getByRole('switch', { name: /Enforce workflow transitions/ })).not.toBeChecked()
    const approvalGate = screen.getByRole('combobox', {
      name: 'Minimum role: Waiting for Approval to Ready',
    })
    expect(approvalGate).toHaveValue('Supervisor')
    expect(screen.getAllByRole('row')).toHaveLength(11)
  })

  it('saves a document with enforcement toggled on', async () => {
    // Arrange
    const user = userEvent.setup()
    const saved: PolicyDocument[] = []
    renderWithProviders(
      <PolicyEditorForm
        value={permissivePolicy}
        laneLabels={laneLabels}
        saving={false}
        onSave={(document) => saved.push(document)}
      />,
    )
    // Act
    await user.click(screen.getByRole('switch', { name: /Enforce workflow transitions/ }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    // Assert
    expect(saved).toHaveLength(1)
    expect(saved[0]?.transitionEnforcement).toBe(true)
    expect(saved[0]?.transitions).toEqual(permissivePolicy.transitions)
  })

  it('saves an edited per-transition role gate', async () => {
    // Arrange
    const user = userEvent.setup()
    const saved: PolicyDocument[] = []
    renderWithProviders(
      <PolicyEditorForm
        value={permissivePolicy}
        laneLabels={laneLabels}
        saving={false}
        onSave={(document) => saved.push(document)}
      />,
    )
    // Act
    await user.click(
      screen.getByRole('combobox', { name: 'Minimum role: Intake to Waiting for Approval' }),
    )
    await user.click(screen.getByRole('option', { name: 'Technician' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    // Assert
    expect(saved[0]?.transitions[0]).toEqual({
      from: 'intake',
      to: 'waiting_approval',
      minRole: 'technician',
    })
  })

  it('saves an action gate and removes it when reset to any role', async () => {
    // Arrange
    const user = userEvent.setup()
    const saved: PolicyDocument[] = []
    renderWithProviders(
      <PolicyEditorForm
        value={permissivePolicy}
        laneLabels={laneLabels}
        saving={false}
        onSave={(document) => saved.push(document)}
      />,
    )
    // Act
    await user.click(screen.getByRole('combobox', { name: 'Cancel cards' }))
    await user.click(screen.getByRole('option', { name: 'Supervisor' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await user.click(screen.getByRole('combobox', { name: 'Cancel cards' }))
    await user.click(screen.getByRole('option', { name: 'Any role' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    // Assert
    expect(saved[0]?.actionGates).toEqual({ cancel: 'supervisor' })
    expect(saved[1]?.actionGates).toEqual({})
  })
})

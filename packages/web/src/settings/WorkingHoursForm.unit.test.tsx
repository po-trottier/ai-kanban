import { type PolicyDocument } from '@rivian-kanban/core'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { permissivePolicy } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { WorkingHoursForm } from './WorkingHoursForm.tsx'

function render(onSave: (document: PolicyDocument) => void = () => undefined) {
  renderWithProviders(<WorkingHoursForm value={permissivePolicy} saving={false} onSave={onSave} />)
}

describe('WorkingHoursForm', () => {
  it('shows the seeded 9:00 AM–5:00 PM working day', () => {
    // Arrange
    const onSave = () => undefined

    // Act
    render(onSave)

    // Assert
    expect(screen.getByRole('combobox', { name: 'Working day starts' })).toHaveValue('9:00 AM')
    expect(screen.getByRole('combobox', { name: 'Working day ends' })).toHaveValue('5:00 PM')
  })

  it('edits the hours and PUTs them with the rest of the policy document', async () => {
    // Arrange
    const user = userEvent.setup()
    const saved: PolicyDocument[] = []
    render((document) => saved.push(document))

    // Act — shift to an 8:00 AM–6:00 PM day, then save.
    await user.click(screen.getByRole('combobox', { name: 'Working day starts' }))
    await user.click(await screen.findByRole('option', { name: '8:00 AM' }))
    await user.click(screen.getByRole('combobox', { name: 'Working day ends' }))
    await user.click(await screen.findByRole('option', { name: '6:00 PM' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // Assert — the edited hours ride along; the roles are carried through untouched.
    expect(saved[0]?.businessHours).toEqual({ startHour: 8, endHour: 18 })
    expect(saved[0]?.roles).toEqual(permissivePolicy.roles)
  })

  it('cannot pick an end hour at or before the start (options are filtered)', async () => {
    // Arrange — start is 9:00 AM, so the "ends" picker offers nothing ≤ 9:00 AM.
    const user = userEvent.setup()
    render()

    // Act
    await user.click(screen.getByRole('combobox', { name: 'Working day ends' }))

    // Assert — the earliest selectable end is 10:00 AM; 9:00 AM is not an option.
    expect(screen.queryByRole('option', { name: '9:00 AM' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: '10:00 AM' })).toBeInTheDocument()
  })
})

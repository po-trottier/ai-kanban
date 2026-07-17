import { type CreateCardInput } from '@rivian-kanban/core'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fixturePickerUsers, fixtureTech } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { NewCardModal } from './NewCardModal.tsx'

const noop = () => undefined

describe('NewCardModal', () => {
  it('requires a title (core createCard schema)', async () => {
    // Arrange
    const user = userEvent.setup()
    const created: CreateCardInput[] = []
    renderWithProviders(
      <NewCardModal
        users={fixturePickerUsers}
        locations={[]}
        knownTags={[]}
        submitting={false}
        onSubmit={(input) => created.push(input)}
        onClose={noop}
      />,
    )
    // Act
    await user.click(screen.getByRole('button', { name: 'Create' }))
    // Assert
    expect(created).toEqual([])
    expect(await screen.findByRole('textbox', { name: /Title/ })).toBeInvalid()
  })

  it('emits the full create command with defaults applied', async () => {
    // Arrange
    const user = userEvent.setup()
    const created: CreateCardInput[] = []
    renderWithProviders(
      <NewCardModal
        users={fixturePickerUsers}
        locations={[]}
        knownTags={['plumbing']}
        submitting={false}
        onSubmit={(input) => created.push(input)}
        onClose={noop}
      />,
    )
    // Act
    await user.type(screen.getByRole('textbox', { name: /Title/ }), 'Broken window')
    await user.click(screen.getByRole('combobox', { name: 'Priority' }))
    await user.click(screen.getByRole('option', { name: 'P1' }))
    await user.click(screen.getByRole('combobox', { name: 'Assignee' }))
    await user.click(screen.getByRole('option', { name: 'Terry Tech' }))
    await user.click(screen.getByRole('button', { name: 'Create' }))
    // Assert
    expect(created).toEqual([
      {
        title: 'Broken window',
        description: '',
        priority: 'P1',
        assigneeId: fixtureTech.id,
        tags: [],
      },
    ])
  })
})

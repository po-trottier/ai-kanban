import { type CreateCardInput, type CreateCardRelationInput } from '@rivian-kanban/core'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch, type FakeRouteResult } from '../test/fake-fetch.ts'
import { fixturePickerUsers } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { CreateCardModal } from './CreateCardModal.tsx'

/** The assignee picker searches `/users/search` as the card fields render. */
function userSearchHandler(_init: RequestInit | undefined, url: string): FakeRouteResult {
  const query = new URLSearchParams(url.split('?')[1] ?? '')
  const q = (query.get('q') ?? '').toLowerCase()
  return fixturePickerUsers.filter((user) => user.displayName.toLowerCase().includes(q))
}

interface Submitted {
  input: CreateCardInput
  relations: CreateCardRelationInput[]
  files: File[]
}

function renderModal(overrides: Partial<Parameters<typeof CreateCardModal>[0]> = {}) {
  const fake = createFakeFetch({ 'GET /api/v1/users/search': userSearchHandler })
  const submitted: Submitted[] = []
  let closed = 0
  renderWithProviders(
    <CreateCardModal
      locations={[]}
      knownTags={[]}
      submitting={false}
      onSubmit={(input, relations, files) => {
        submitted.push({ input, relations, files })
      }}
      onClose={() => {
        closed += 1
      }}
      {...overrides}
    />,
    { fetchFn: fake.fetch },
  )
  return { fake, submitted, closedCount: () => closed }
}

describe('CreateCardModal', () => {
  it('opens an empty form modal with a Cancel/Create footer and no draft POST', () => {
    // Arrange
    // Act — mounting the button's modal is opening it.
    const { fake } = renderModal()
    // Assert — a real "New work order" form: empty title, no State picker (always
    // Intake), a Cancel/Create footer, and nothing POSTed just by opening.
    expect(screen.getByRole('dialog', { name: 'New work order' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Title/ })).toHaveValue('')
    expect(screen.queryByRole('combobox', { name: 'State' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    expect(fake.calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('blocks Create with an empty title (core schema validation, no submit)', async () => {
    // Arrange
    const user = userEvent.setup()
    const { submitted } = renderModal()
    // Act — Create with the untouched, empty title.
    await user.click(screen.getByRole('button', { name: 'Create' }))
    // Assert — validation stops it: onSubmit never ran, the title shows invalid.
    expect(submitted).toEqual([])
    expect(screen.getByRole('textbox', { name: /Title/ })).toBeInvalid()
  })

  it('submits the entered fields on Create', async () => {
    // Arrange
    const user = userEvent.setup()
    const { submitted } = renderModal()
    // Act
    await user.type(screen.getByRole('textbox', { name: /Title/ }), 'Broken door')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    // Assert — the create command carries the field + the schema defaults.
    expect(submitted).toHaveLength(1)
    expect(submitted[0]?.input).toEqual({
      title: 'Broken door',
      description: '',
      priority: 'P2',
      tags: [],
    })
  })

  it('closes on Cancel without submitting', async () => {
    // Arrange
    const user = userEvent.setup()
    const { submitted, closedCount } = renderModal()
    // Act
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    // Assert
    expect(closedCount()).toBe(1)
    expect(submitted).toEqual([])
  })

  it('closes on ✕ without submitting', async () => {
    // Arrange
    const user = userEvent.setup()
    const { submitted, closedCount } = renderModal()
    // Act
    const dialog = screen.getByRole('dialog', { name: 'New work order' })
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    // Assert
    expect(closedCount()).toBe(1)
    expect(submitted).toEqual([])
  })

  it('stages a picked file and submits it with the fields on Create', async () => {
    // Arrange
    const user = userEvent.setup()
    const { submitted } = renderModal()
    // Act — attach a file, fill the title, then Create.
    const file = new File(['x'], 'photo.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText<HTMLInputElement>('Browse files'), file)
    await user.type(screen.getByRole('textbox', { name: /Title/ }), 'Broken door')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    // Assert — the staged file rode along in the submit.
    expect(submitted[0]?.files.map((staged) => staged.name)).toEqual(['photo.png'])
  })
})

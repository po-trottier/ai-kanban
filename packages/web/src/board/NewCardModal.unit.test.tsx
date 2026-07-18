import { type CreateCardInput } from '@rivian-kanban/core'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch } from '../test/fake-fetch.ts'
import { fixturePickerUsers, fixtureTech } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { NewCardModal } from './NewCardModal.tsx'

const noop = () => undefined

/** The Assignee picker is async: it hits `GET /users/search` (`?q=` free-text). */
const userSearchRoutes = { 'GET /api/v1/users/search': fixturePickerUsers }

function renderModal(props: Partial<Parameters<typeof NewCardModal>[0]> = {}) {
  const fake = createFakeFetch(userSearchRoutes)
  renderWithProviders(
    <NewCardModal
      locations={[]}
      knownTags={[]}
      submitting={false}
      onSubmit={noop}
      onClose={noop}
      {...props}
    />,
    { fetchFn: fake.fetch },
  )
  return fake
}

describe('NewCardModal', () => {
  it('requires a title (core createCard schema)', async () => {
    // Arrange
    const user = userEvent.setup()
    const created: CreateCardInput[] = []
    renderModal({ onSubmit: (input) => created.push(input) })
    // Act
    await user.click(screen.getByRole('button', { name: 'Create' }))
    // Assert
    expect(created).toEqual([])
    expect(await screen.findByRole('textbox', { name: /Title/ })).toBeInvalid()
  })

  it('describes each priority in plain language in the dropdown (ITEM 3)', async () => {
    // Arrange
    const user = userEvent.setup()
    renderModal()
    // Act
    await user.click(screen.getByRole('combobox', { name: 'Priority' }))
    // Assert — the labels and the dimmed descriptions both render so a
    // non-technical user understands the codes (P0 = drop everything).
    expect(screen.getByRole('option', { name: /P0 — Critical/ })).toBeInTheDocument()
    expect(screen.getByText('Drop everything')).toBeInTheDocument()
    expect(screen.getByText('Do soon')).toBeInTheDocument()
    expect(screen.getByText('Routine work')).toBeInTheDocument()
  })

  it('emits the full create command with defaults applied', async () => {
    // Arrange
    const user = userEvent.setup()
    const created: CreateCardInput[] = []
    renderModal({ knownTags: ['plumbing'], onSubmit: (input) => created.push(input) })
    // Act
    await user.type(screen.getByRole('textbox', { name: /Title/ }), 'Broken window')
    await user.click(screen.getByRole('combobox', { name: 'Priority' }))
    // Each priority option now carries a plain-language description (ITEM 3),
    // so its accessible name is "P1 — High" plus the "Do soon" hint.
    await user.click(screen.getByRole('option', { name: /P1 — High/ }))
    // The Assignee picker is async — opening it fetches `/users/search`.
    await user.click(screen.getByRole('combobox', { name: 'Assignee' }))
    await user.click(await screen.findByRole('option', { name: 'Terry Tech' }))
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

  it('collects an attachment and passes it to onSubmit for post-create upload', async () => {
    // Arrange
    const user = userEvent.setup()
    const submitted: File[][] = []
    renderModal({
      onSubmit: (_input, files) => {
        submitted.push(files)
      },
    })
    // Act — title + pick a file (which lists in the pending section), then create
    await user.type(screen.getByRole('textbox', { name: /Title/ }), 'Leaky faucet')
    const file = new File(['png-bytes'], 'leak.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText<HTMLInputElement>('Browse files'), file)
    expect(screen.getByText('leak.png')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create' }))
    // Assert — the picked file rides along to the caller (uploaded after create)
    expect(submitted).toHaveLength(1)
    expect(submitted[0]?.map((entry) => entry.name)).toEqual(['leak.png'])
  })
})

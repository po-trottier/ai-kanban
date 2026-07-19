import { type CardRelationView } from '@rivian-kanban/core'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch, jsonResponse } from '../test/fake-fetch.ts'
import { uid } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { RelationsSection } from './RelationsSection.tsx'

function view(overrides: Partial<CardRelationView> = {}): CardRelationView {
  return {
    id: uid(700),
    type: 'blocks',
    direction: 'outgoing',
    card: { id: 7, title: 'Downstream' },
    ...overrides,
  }
}

describe('RelationsSection', () => {
  it('labels each relation as seen from THIS card and links to the other card', async () => {
    // Arrange — an outgoing block and an incoming duplicate.
    const relations = [
      view({
        id: uid(700),
        type: 'blocks',
        direction: 'outgoing',
        card: { id: 7, title: 'Downstream' },
      }),
      view({
        id: uid(701),
        type: 'duplicates',
        direction: 'incoming',
        card: { id: 3, title: 'Older dupe' },
      }),
    ]
    const fake = createFakeFetch({
      'GET /api/v1/cards/5/relations': relations,
      'GET /api/v1/cards': { items: [], nextCursor: null },
    })
    // Act
    renderWithProviders(<RelationsSection cardId="5" />, { fetchFn: fake.fetch })
    // Assert — wait for the relation links (unambiguous, unlike the "Blocks" the
    // add-form type select also shows), then check the INVERSE label mapping:
    // an incoming `duplicates` reads "Duplicated by" (unique to the relation row).
    expect(await screen.findByRole('button', { name: /#7 — Downstream/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /#3 — Older dupe/ })).toBeInTheDocument()
    expect(screen.getByText('Duplicated by')).toBeInTheDocument()
  })

  it('adds a relation: pick a type, search a card, and POST it', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/cards/5/relations': [],
      'GET /api/v1/cards': { items: [{ id: 9, title: 'Install fixtures' }], nextCursor: null },
      'POST /api/v1/cards/5/relations': jsonResponse(
        view({ id: uid(702), card: { id: 9, title: 'Install fixtures' } }),
        201,
      ),
    })
    renderWithProviders(<RelationsSection cardId="5" />, { fetchFn: fake.fetch })
    await screen.findByText('No related cards yet.')
    // Act — open the modal, search for the target card, pick it, add (type
    // defaults to Blocks).
    await user.click(screen.getByRole('button', { name: 'Add relationship' }))
    await user.click(await screen.findByRole('combobox', { name: 'Related card' }))
    await user.type(screen.getByRole('combobox', { name: 'Related card' }), 'Install')
    await user.click(await screen.findByRole('option', { name: /#9 — Install fixtures/ }))
    await user.click(screen.getByRole('button', { name: 'Add relation' }))
    // Assert — the POST carries the picked card id + the chosen type; a toast
    // fires and the modal closes on success.
    expect(await screen.findByText('Relation added')).toBeInTheDocument()
    expect(fake.lastBody('POST', '/api/v1/cards/5/relations')).toEqual({
      toCardId: 9,
      type: 'blocks',
    })
    expect(screen.queryByRole('button', { name: 'Add relation' })).not.toBeInTheDocument()
  })

  it('removes a relation (DELETE)', async () => {
    // Arrange
    const user = userEvent.setup()
    const relation = view({
      id: uid(703),
      type: 'relates_to',
      direction: 'outgoing',
      card: { id: 4, title: 'Sibling task' },
    })
    const fake = createFakeFetch({
      'GET /api/v1/cards/5/relations': [relation],
      'GET /api/v1/cards': { items: [], nextCursor: null },
      [`DELETE /api/v1/cards/5/relations/${relation.id}`]: jsonResponse(null, 204),
    })
    renderWithProviders(<RelationsSection cardId="5" />, { fetchFn: fake.fetch })
    // Wait for the relation to load (its remove control is unambiguous).
    await screen.findByRole('button', { name: 'Remove relation to Sibling task' })
    // Act
    await user.click(screen.getByRole('button', { name: 'Remove relation to Sibling task' }))
    // Assert
    expect(await screen.findByText('Relation removed')).toBeInTheDocument()
    expect(
      fake.calls.some(
        (call) =>
          call.method === 'DELETE' && call.url === `/api/v1/cards/5/relations/${relation.id}`,
      ),
    ).toBe(true)
  })

  it('is read-only when archived: no add button, no remove buttons', async () => {
    // Arrange
    const fake = createFakeFetch({ 'GET /api/v1/cards/5/relations': [view()] })
    // Act
    renderWithProviders(<RelationsSection cardId="5" readOnly />, { fetchFn: fake.fetch })
    await screen.findByText('Blocks')
    // Assert — relations are shown, but nothing can be added or removed.
    expect(screen.queryByRole('button', { name: 'Add relationship' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove relation/ })).not.toBeInTheDocument()
  })

  it('opens and cancels the add-relationship modal without posting', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/cards/5/relations': [],
      'GET /api/v1/cards': { items: [], nextCursor: null },
    })
    renderWithProviders(<RelationsSection cardId="5" />, { fetchFn: fake.fetch })
    await screen.findByText('No related cards yet.')
    // Act — open the modal, then cancel it.
    await user.click(screen.getByRole('button', { name: 'Add relationship' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    // Assert — the modal is gone and nothing was posted.
    expect(screen.queryByRole('button', { name: 'Add relation' })).not.toBeInTheDocument()
    expect(fake.calls.some((call) => call.method === 'POST')).toBe(false)
  })
})

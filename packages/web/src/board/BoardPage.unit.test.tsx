import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import {
  createFakeFetch,
  jsonResponse,
  problemResponse,
  type FakeFetch,
} from '../test/fake-fetch.ts'
import {
  fixtureAdmin,
  fixturePickerUsers,
  makeBoard,
  nth,
  makeCard,
  permissivePolicy,
  policyRecordOf,
} from '../test/fixtures.ts'
import { renderApp } from '../test/render.tsx'
import { type BoardCard } from '../api/schemas.ts'

function boardApp(
  cards: { ready?: BoardCard[]; intake?: BoardCard[] },
  extra: Record<string, unknown> = {},
): FakeFetch {
  return createFakeFetch({
    'GET /api/v1/auth/me': fixtureAdmin,
    'GET /api/v1/board': makeBoard(cards),
    'GET /api/v1/policy': policyRecordOf(permissivePolicy),
    'GET /api/v1/users': fixturePickerUsers,
    'GET /api/v1/locations': [],
    'GET /api/v1/tags': [],
    ...extra,
  })
}

async function openCardMenu(user: ReturnType<typeof userEvent.setup>, title: string) {
  const card = await screen.findByLabelText(title)
  await user.click(within(card).getByRole('button', { name: 'Card actions' }))
}

describe('BoardPage move flows', () => {
  it('sends only neighbor ids + If-Match through the Move to… menu (ADR-007)', async () => {
    // Arrange
    const user = userEvent.setup()
    const a = makeCard('ready', { title: 'First in ready' })
    const moving = makeCard('intake', { title: 'Triaged card', version: 7 })
    const fake = boardApp(
      { ready: [a], intake: [moving] },
      { [`POST /api/v1/cards/${moving.id}/move`]: moving },
    )
    renderApp({ fetchFn: fake.fetch })
    // Act
    await openCardMenu(user, 'Triaged card')
    await user.click(await screen.findByRole('menuitem', { name: 'Move to…' }))
    await user.click(await screen.findByRole('combobox', { name: 'Column' }))
    await user.click(screen.getByRole('option', { name: 'Ready' }))
    await user.click(screen.getByRole('combobox', { name: 'Position' }))
    await user.click(screen.getByRole('option', { name: 'After "First in ready"' }))
    await user.click(screen.getByRole('button', { name: 'Move' }))
    // Assert
    expect(fake.lastBody('POST', `/api/v1/cards/${moving.id}/move`)).toEqual({
      toLane: 'ready',
      prevCardId: a.id,
      nextCardId: null,
    })
    const call = fake.calls.find((c) => c.method === 'POST' && c.url.includes('/move'))
    expect(new Headers(call?.init?.headers).get('If-Match')).toBe('"7"')
  })

  it('prompts for reason and resume date when moving into the waiting lane', async () => {
    // Arrange
    const user = userEvent.setup()
    const moving = makeCard('intake', { title: 'Needs parts', version: 2 })
    const fake = boardApp(
      { intake: [moving] },
      { [`POST /api/v1/cards/${moving.id}/move`]: moving },
    )
    renderApp({ fetchFn: fake.fetch })
    // Act
    await openCardMenu(user, 'Needs parts')
    await user.click(await screen.findByRole('menuitem', { name: 'Move to…' }))
    await user.click(await screen.findByRole('combobox', { name: 'Column' }))
    await user.click(screen.getByRole('option', { name: 'Waiting on Parts / Vendor' }))
    await user.click(screen.getByRole('button', { name: 'Move' }))
    await user.click(await screen.findByRole('combobox', { name: 'Waiting reason' }))
    await user.click(screen.getByRole('option', { name: 'Vendor' }))
    await user.click(screen.getByRole('button', { name: 'Expected resume date' }))
    await user.click(nth(screen.getAllByRole('button', { name: /20 July 2026/ }), 0))
    await user.click(screen.getByRole('button', { name: 'Move card' }))
    // Assert
    expect(fake.lastBody('POST', `/api/v1/cards/${moving.id}/move`)).toMatchObject({
      toLane: 'waiting_parts_vendor',
      waitingReason: 'vendor',
      expectedResumeAt: '2026-07-20',
    })
  })

  it('rolls back and shows the conflict toast on a 409 (ADR-012)', async () => {
    // Arrange
    const user = userEvent.setup()
    const a = makeCard('ready', { title: 'Target neighbor' })
    const moving = makeCard('intake', { title: 'Contended card', version: 1 })
    const fake = boardApp(
      { ready: [a], intake: [moving] },
      {
        [`POST /api/v1/cards/${moving.id}/move`]: () => problemResponse(409, { title: 'Conflict' }),
      },
    )
    renderApp({ fetchFn: fake.fetch })
    // Act
    await openCardMenu(user, 'Contended card')
    await user.click(await screen.findByRole('menuitem', { name: 'Move to…' }))
    await user.click(await screen.findByRole('combobox', { name: 'Column' }))
    await user.click(screen.getByRole('option', { name: 'Ready' }))
    await user.click(screen.getByRole('button', { name: 'Move' }))
    // Assert
    expect(
      await screen.findByText(
        'This card was just updated by someone else — the board has been refreshed.',
      ),
    ).toBeInTheDocument()
    const intake = screen.getByRole('list', { name: 'Cards in Intake' })
    expect(within(intake).getByText('Contended card')).toBeInTheDocument()
  })
})

describe('BoardPage card actions', () => {
  it('blocks a card with a reason through the ⋯ menu', async () => {
    // Arrange
    const user = userEvent.setup()
    const card = makeCard('in_progress', { title: 'Stuck card', version: 3 })
    const fake = boardApp(
      { intake: [card] },
      { [`POST /api/v1/cards/${card.id}/block`]: jsonResponse(card) },
    )
    renderApp({ fetchFn: fake.fetch })
    // Act
    await openCardMenu(user, 'Stuck card')
    await user.click(await screen.findByRole('menuitem', { name: 'Block…' }))
    await user.type(
      screen.getByRole('textbox', { name: 'What is blocking this card?' }),
      'vendor no-show',
    )
    await user.click(screen.getByRole('button', { name: 'Block card' }))
    // Assert
    expect(fake.lastBody('POST', `/api/v1/cards/${card.id}/block`)).toEqual({
      reason: 'vendor no-show',
    })
  })

  it('cancels a card with a resolution through the ⋯ menu (never a drag)', async () => {
    // Arrange
    const user = userEvent.setup()
    const card = makeCard('intake', { title: 'Duplicate request', version: 5 })
    const fake = boardApp(
      { intake: [card] },
      { [`POST /api/v1/cards/${card.id}/cancel`]: jsonResponse(card) },
    )
    renderApp({ fetchFn: fake.fetch })
    // Act
    await openCardMenu(user, 'Duplicate request')
    await user.click(await screen.findByRole('menuitem', { name: 'Cancel…' }))
    await user.click(screen.getByRole('combobox', { name: 'Reason' }))
    await user.click(screen.getByRole('option', { name: 'Duplicate' }))
    await user.click(screen.getByRole('button', { name: 'Cancel card' }))
    // Assert
    expect(fake.lastBody('POST', `/api/v1/cards/${card.id}/cancel`)).toEqual({
      resolution: 'duplicate',
    })
    const call = fake.calls.find((c) => c.url.includes('/cancel'))
    expect(new Headers(call?.init?.headers).get('If-Match')).toBe('"5"')
  })

  it('unblocks a blocked card directly from the menu', async () => {
    // Arrange
    const user = userEvent.setup()
    const card = makeCard('in_progress', {
      title: 'Blocked card',
      blocked: true,
      blockedReason: 'no parts',
      blockedAt: '2026-07-10T08:00:00.000Z',
      version: 2,
    })
    const fake = boardApp(
      { intake: [card] },
      { [`POST /api/v1/cards/${card.id}/unblock`]: jsonResponse(card) },
    )
    renderApp({ fetchFn: fake.fetch })
    // Act
    await openCardMenu(user, 'Blocked card')
    await user.click(await screen.findByRole('menuitem', { name: 'Unblock' }))
    // Assert
    expect(fake.lastBody('POST', `/api/v1/cards/${card.id}/unblock`)).toEqual({})
  })

  it('reopens a terminal card from the menu (cancel is replaced by reopen)', async () => {
    // Arrange
    const user = userEvent.setup()
    const card = makeCard('done', { title: 'Finished card', resolution: 'completed', version: 9 })
    const fake = boardApp(
      { intake: [card] },
      { [`POST /api/v1/cards/${card.id}/reopen`]: jsonResponse(card) },
    )
    renderApp({ fetchFn: fake.fetch })
    // Act
    await openCardMenu(user, 'Finished card')
    await user.click(await screen.findByRole('menuitem', { name: 'Reopen' }))
    // Assert
    expect(fake.lastBody('POST', `/api/v1/cards/${card.id}/reopen`)).toEqual({})
    const call = fake.calls.find((c) => c.url.includes('/reopen'))
    expect(new Headers(call?.init?.headers).get('If-Match')).toBe('"9"')
  })

  it('shows the problem+json error when the board fails to load', async () => {
    // Arrange
    const fake = createFakeFetch({
      'GET /api/v1/auth/me': fixtureAdmin,
      'GET /api/v1/board': () => problemResponse(500, { title: 'Database unavailable' }),
      'GET /api/v1/policy': policyRecordOf(permissivePolicy),
      'GET /api/v1/users': fixturePickerUsers,
      'GET /api/v1/locations': [],
      'GET /api/v1/tags': [],
    })
    // Act
    renderApp({ fetchFn: fake.fetch })
    // Assert
    expect(await screen.findByText('Database unavailable')).toBeInTheDocument()
  })

  it('surfaces non-conflict move failures as an error toast', async () => {
    // Arrange
    const user = userEvent.setup()
    const moving = makeCard('intake', { title: 'Doomed move' })
    const fake = boardApp(
      { intake: [moving] },
      {
        [`POST /api/v1/cards/${moving.id}/move`]: () =>
          problemResponse(422, { title: 'Illegal transition' }),
      },
    )
    renderApp({ fetchFn: fake.fetch })
    // Act
    await openCardMenu(user, 'Doomed move')
    await user.click(await screen.findByRole('menuitem', { name: 'Move to…' }))
    await user.click(await screen.findByRole('combobox', { name: 'Column' }))
    await user.click(screen.getByRole('option', { name: 'Done' }))
    await user.click(screen.getByRole('button', { name: 'Move' }))
    // Assert
    expect(await screen.findByText('Illegal transition')).toBeInTheDocument()
  })

  it('disables cancel when the policy gates it below the user role', async () => {
    // Arrange
    const user = userEvent.setup()
    const card = makeCard('intake', { title: 'Gated card' })
    const gatedPolicy = { ...permissivePolicy, actionGates: { cancel: 'admin' as const } }
    const fake = createFakeFetch({
      'GET /api/v1/auth/me': { ...fixtureAdmin, role: 'technician' },
      'GET /api/v1/board': makeBoard({ intake: [card] }),
      'GET /api/v1/policy': policyRecordOf(gatedPolicy),
      'GET /api/v1/users': fixturePickerUsers,
      'GET /api/v1/locations': [],
      'GET /api/v1/tags': [],
    })
    renderApp({ fetchFn: fake.fetch })
    // Act
    await openCardMenu(user, 'Gated card')
    // Assert
    expect(await screen.findByRole('menuitem', { name: 'Cancel…' })).toHaveAttribute(
      'data-disabled',
    )
  })
})

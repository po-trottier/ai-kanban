import { type PolicyDocument } from '@rivian-kanban/core'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch, problemResponse } from '../test/fake-fetch.ts'
import {
  fixtureAdmin,
  fixturePickerUsers,
  laneByKey,
  makeBoard,
  nth,
  permissivePolicy,
  policyRecordOf,
} from '../test/fixtures.ts'
import { renderApp } from '../test/render.tsx'

function settingsApp(extra: Record<string, unknown> = {}) {
  return createFakeFetch({
    'GET /api/v1/auth/me': fixtureAdmin,
    'GET /api/v1/board': makeBoard({}),
    'GET /api/v1/policy': policyRecordOf(permissivePolicy),
    'GET /api/v1/users': fixturePickerUsers,
    'GET /api/v1/users/search': fixturePickerUsers,
    'GET /api/v1/locations': [],
    'GET /api/v1/tags': [],
    'GET /api/v1/service-tokens': [],
    ...extra,
  })
}

describe('SettingsPage', () => {
  it('publishes an edited role grant through PUT /policy from the Permissions tab', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = settingsApp({ 'PUT /api/v1/policy': policyRecordOf(permissivePolicy) })
    renderApp({ fetchFn: fake.fetch, route: '/settings' })
    // Act — the Permissions tab now edits roles only (transitions moved to Columns).
    await user.click(await screen.findByRole('tab', { name: 'Permissions' }))
    await user.click(
      await screen.findByRole('checkbox', { name: 'Delete others’ comments for User' }),
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))
    // Assert — the granted permission rides the PUT body.
    const userRole = (fake.lastBody('PUT', '/api/v1/policy') as PolicyDocument).roles.find(
      (role) => role.key === 'user',
    )
    expect(userRole?.permissions['comment.deleteOthers']).toBe(true)
    expect(await screen.findByText('Policy updated')).toBeInTheDocument()
  })

  it('publishes edited workflow transitions through PUT /policy from the Columns tab', async () => {
    // Arrange — the transitions matrix now lives with the columns.
    const user = userEvent.setup()
    const fake = settingsApp({ 'PUT /api/v1/policy': policyRecordOf(permissivePolicy) })
    renderApp({ fetchFn: fake.fetch, route: '/settings' })
    // Act — enforce moves and save from the Columns tab.
    await user.click(await screen.findByRole('tab', { name: 'Columns' }))
    await user.click(await screen.findByRole('switch', { name: /Enforce these moves/ }))
    // The transitions matrix has its own distinctly-named Save (the per-column
    // rows use plain "Save"), so target it directly.
    await user.click(screen.getByRole('button', { name: 'Save transitions' }))
    // Assert
    expect(fake.lastBody('PUT', '/api/v1/policy')).toMatchObject({ transitionEnforcement: true })
    expect(await screen.findByText('Policy updated')).toBeInTheDocument()
  })

  it('shows an error toast when an admin mutation fails', async () => {
    // Arrange
    const user = userEvent.setup()
    const ready = laneByKey('ready')
    const fake = settingsApp({
      [`PATCH /api/v1/lanes/${ready.id}`]: () => problemResponse(409, { title: 'Stale lane' }),
    })
    renderApp({ fetchFn: fake.fetch, route: '/settings' })
    // Act
    await user.click(await screen.findByRole('tab', { name: 'Columns' }))
    const label = await screen.findByRole('textbox', { name: 'Column label (Ready)' })
    await user.clear(label)
    await user.type(label, 'Approved')
    await user.click(nth(screen.getAllByRole('button', { name: 'Save' }), 2))
    // Assert
    expect(await screen.findByText('Stale lane')).toBeInTheDocument()
  })

  it('opens the tab named by ?tab= so deep links (e.g. Locations) land right', async () => {
    // Arrange
    const fake = settingsApp()
    // Act — the empty LocationPicker links here.
    renderApp({ fetchFn: fake.fetch, route: '/settings?tab=locations' })
    // Assert
    expect(
      await screen.findByRole('tab', { name: 'Locations', selected: true }),
    ).toBeInTheDocument()
  })
})

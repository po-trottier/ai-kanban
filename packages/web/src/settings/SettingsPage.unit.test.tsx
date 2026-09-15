import { type PolicyDocument } from '@rivian-kanban/core'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch, problemResponse } from '../test/fake-fetch.ts'
import {
  fixtureAdmin,
  uid,
  fixturePickerUsers,
  laneByKey,
  makeBoard,
  makeBoardCatalog,
  makeBoardEntity,
  nth,
  permissivePolicy,
  policyRecordOf,
} from '../test/fixtures.ts'
import { renderApp } from '../test/render.tsx'
import { strings } from '../strings.ts'

const defaultBoard = makeBoardEntity({ id: uid(501), name: 'Facilities', isDefault: true })

function settingsApp(extra: Record<string, unknown> = {}) {
  return createFakeFetch({
    'GET /api/v1/auth/me': fixtureAdmin,
    'GET /api/v1/board': makeBoard({}),
    'GET /api/v1/boards': makeBoardCatalog([defaultBoard], true),
    'GET /api/v1/policy': policyRecordOf(permissivePolicy),
    'GET /api/v1/users': fixturePickerUsers,
    'GET /api/v1/users/search': fixturePickerUsers,
    'GET /api/v1/locations': [],
    'GET /api/v1/groups': [],
    'GET /api/v1/tags': [],
    'GET /api/v1/service-tokens': [],
    ...extra,
  })
}

describe('SettingsPage', () => {
  it('switches column boards in place and sends edits to the selected board', async () => {
    // Arrange
    const user = userEvent.setup()
    const warehouse = makeBoardEntity({ id: uid(502), name: 'Warehouse' })
    const warehouseBoard = makeBoard({})
    warehouseBoard.lanes = warehouseBoard.lanes.map((snapshot, index) => ({
      ...snapshot,
      lane: {
        ...snapshot.lane,
        id: uid(700 + index),
        boardId: warehouse.id,
        label: `Warehouse ${snapshot.lane.label}`,
      },
    }))
    const intake = nth(warehouseBoard.lanes, 0).lane
    const fake = settingsApp({
      'GET /api/v1/boards': makeBoardCatalog([defaultBoard, warehouse], true),
      'GET /api/v1/board': (init: RequestInit | undefined) =>
        new Headers(init?.headers).get('X-Board-Id') === warehouse.id
          ? warehouseBoard
          : makeBoard({}),
      [`PATCH /api/v1/lanes/${intake.id}`]: { ...intake, label: 'Receiving' },
    })
    renderApp({ fetchFn: fake.fetch, route: '/settings?tab=lanes' })
    // Act
    await user.click(await screen.findByRole('combobox', { name: 'Board' }))
    await user.click(await screen.findByRole('option', { name: 'Warehouse' }))
    const label = await screen.findByRole('textbox', { name: `Column label (${intake.label})` })
    await user.clear(label)
    await user.type(label, 'Receiving')
    await user.click(nth(screen.getAllByRole('button', { name: 'Save' }), 0))
    // Assert
    expect(screen.getByRole('tab', { name: 'Columns', selected: true })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Board' })).toHaveValue('Warehouse')
    const patch = fake.calls.findLast((call) => call.method === 'PATCH')
    expect(new Headers(patch?.init?.headers).get('X-Board-Id')).toBe(warehouse.id)
    expect(fake.lastBody('PATCH', `/api/v1/lanes/${intake.id}`)).toEqual({
      label: 'Receiving',
      wipLimit: null,
    })
  })
  it('removes a reason even after its unsaved name was cleared, preserving its stored label', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = settingsApp({ 'PUT /api/v1/policy': policyRecordOf(permissivePolicy) })
    renderApp({ fetchFn: fake.fetch, route: '/settings?tab=waiting-reasons' })
    // Act
    await user.clear(await screen.findByRole('textbox', { name: 'Reason name (Parts)' }))
    await user.click(screen.getByRole('button', { name: 'Remove reason ()' }))
    await user.click(screen.getByRole('button', { name: 'Save reasons' }))
    // Assert
    expect(
      (fake.lastBody('PUT', '/api/v1/policy') as PolicyDocument).waitingReasons,
    ).toContainEqual({ key: 'parts', label: 'Parts', active: false })
  })
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
    expect(screen.getByRole('combobox', { name: 'Board' })).toHaveValue('Facilities')
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

  it('opens the Boards tab named by ?tab=boards (the header "Manage boards" deep link)', async () => {
    // Arrange
    const fake = settingsApp()
    // Act
    renderApp({ fetchFn: fake.fetch, route: '/settings?tab=boards' })
    // Assert
    expect(await screen.findByRole('tab', { name: 'Boards', selected: true })).toBeInTheDocument()
    expect(await screen.findByRole('row', { name: /Facilities/ })).toBeInTheDocument()
  })

  it('lets non-admins choose a default while hiding board mutation controls', async () => {
    // Arrange
    const user = userEvent.setup()
    const warehouse = makeBoardEntity({ id: uid(502), name: 'Warehouse' })
    const catalog = makeBoardCatalog([defaultBoard, warehouse], false)
    const fake = settingsApp({
      'GET /api/v1/boards': catalog,
      'PUT /api/v1/boards/preference': {
        ...catalog,
        preferredBoardId: warehouse.id,
        defaultBoardId: warehouse.id,
        defaultSource: 'personal',
      },
    })
    // Act
    renderApp({ fetchFn: fake.fetch, route: '/settings?tab=boards' })
    await screen.findByRole('row', { name: /Warehouse/ })
    await user.click(await screen.findByRole('combobox', { name: 'My default board' }))
    await user.click(await screen.findByRole('option', { name: 'Warehouse' }))
    // Assert
    expect(fake.lastBody('PUT', '/api/v1/boards/preference')).toEqual({ boardId: warehouse.id })
    expect(screen.getByRole('tab', { name: 'Boards' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add board' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit \(/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Delete.*Facilities/ })).not.toBeInTheDocument()
  })

  it('creates a restricted board with the selected roles through POST /boards', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = settingsApp({
      'POST /api/v1/boards': makeBoardEntity({ id: uid(502), name: 'Warehouse' }),
    })
    renderApp({ fetchFn: fake.fetch, route: '/settings?tab=boards' })
    // Act
    await user.click(await screen.findByRole('button', { name: 'Add board' }))
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Warehouse')
    await user.click(screen.getByRole('radio', { name: 'Restricted' }))
    await user.click(screen.getByRole('button', { name: 'Create' }))
    // Assert
    expect(fake.lastBody('POST', '/api/v1/boards')).toMatchObject({
      name: 'Warehouse',
      accessMode: 'restricted',
      allowedRoleKeys: [],
      allowedUserIds: [],
    })
  })

  it('disables deleting the last active board', async () => {
    // Arrange
    const fake = settingsApp()
    renderApp({ fetchFn: fake.fetch, route: '/settings?tab=boards' })
    // Act
    await screen.findByRole('row', { name: /Facilities/ })
    // Assert
    expect(
      screen.getByRole('button', { name: `${strings.tooltips.deleteBoard} (Facilities)` }),
    ).toBeDisabled()
  })
})

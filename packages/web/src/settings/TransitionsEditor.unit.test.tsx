import { type PolicyDocument } from '@rivian-kanban/core'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch } from '../test/fake-fetch.ts'
import { enforcedPolicy, makeBoard, permissivePolicy, policyRecordOf } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { TransitionsEditor } from './TransitionsEditor.tsx'

// The default board has 7 lanes; the seeded policy graph is permissive-off.
const LANE_COUNT = 7

function mountEditor(policy: PolicyDocument = permissivePolicy) {
  const fake = createFakeFetch({
    'GET /api/v1/board': makeBoard({}),
    'GET /api/v1/policy': policyRecordOf(policy),
    'PUT /api/v1/policy': policyRecordOf(policy),
  })
  renderWithProviders(<TransitionsEditor />, { fetchFn: fake.fetch })
  return fake
}

describe('TransitionsEditor', () => {
  it('renders a full n×n lattice: an interactive cell off-diagonal, a fixed one on it', async () => {
    // Arrange
    mountEditor()

    // Act
    await screen.findByRole('checkbox', { name: 'Allow move from Intake to Ready' })

    // Assert — every cell carries a checkbox (nothing blank): n*(n-1) editable
    // move cells + n diagonal identity cells = n² controls, an even lattice.
    const editable = screen.getAllByRole('checkbox', { name: /^Allow move from / })
    const identity = screen.getAllByRole('checkbox', { name: /keeps work orders in place/ })
    expect(editable).toHaveLength(LANE_COUNT * (LANE_COUNT - 1))
    expect(identity).toHaveLength(LANE_COUNT)
  })

  it('renders each diagonal (from === to) as a disabled, checked identity cell', async () => {
    // Arrange
    mountEditor()

    // Act — Intake→Intake is a control, not a blank cell: disabled + checked.
    const identity = await screen.findByRole('checkbox', {
      name: 'Intake keeps work orders in place (always allowed)',
    })

    // Assert
    expect(identity).toBeDisabled()
    expect(identity).toBeChecked()
    // And it is never stored as an edge to PUT (the diagonal has no onChange).
    expect(
      screen.queryByRole('checkbox', { name: 'Allow move from Intake to Intake' }),
    ).not.toBeInTheDocument()
  })

  it('lays the matrix out with a fixed grid so cells do not size to their label', async () => {
    // Arrange
    mountEditor()

    // Act — the from×to table uses the fixed-layout class (an even lattice
    // regardless of label length); table-layout:fixed lives in the CSS module.
    const table = await screen.findByRole('table', {
      name: 'Allowed moves between columns matrix',
    })

    // Assert
    expect(table.className).not.toBe('')
    // Header carries the axis legend and a truncatable label per live column.
    expect(within(table).getByText('From ↓ / To →')).toBeInTheDocument()
    expect(within(table).getAllByRole('columnheader')).toHaveLength(LANE_COUNT + 1)
  })

  it('toggling a cell on then saving PUTs the new edge (roles untouched)', async () => {
    // Arrange — Intake→Ready is not a seeded edge.
    const user = userEvent.setup()
    const fake = mountEditor()

    // Act
    await user.click(
      await screen.findByRole('checkbox', { name: 'Allow move from Intake to Ready' }),
    )
    await user.click(screen.getByRole('button', { name: 'Save transitions' }))

    // Assert
    const body = fake.lastBody('PUT', '/api/v1/policy') as PolicyDocument
    expect(body.transitions).toContainEqual({ from: 'intake', to: 'ready' })
    expect(body.roles).toEqual(permissivePolicy.roles)
  })

  it('toggling an existing cell off then saving drops that edge', async () => {
    // Arrange — Intake→Waiting for Approval IS a seeded edge.
    const user = userEvent.setup()
    const fake = mountEditor()

    // Act
    await user.click(
      await screen.findByRole('checkbox', {
        name: 'Allow move from Intake to Waiting for Approval',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Save transitions' }))

    // Assert
    const body = fake.lastBody('PUT', '/api/v1/policy') as PolicyDocument
    expect(body.transitions).not.toContainEqual({ from: 'intake', to: 'waiting_approval' })
  })

  it('saves the enforcement toggle without touching the roles or edges', async () => {
    // Arrange — enforcement is off in the seed.
    const user = userEvent.setup()
    const fake = mountEditor()

    // Act
    await user.click(await screen.findByRole('switch', { name: /Enforce these moves/ }))
    await user.click(screen.getByRole('button', { name: 'Save transitions' }))

    // Assert
    const body = fake.lastBody('PUT', '/api/v1/policy') as PolicyDocument
    expect(body.transitionEnforcement).toBe(true)
    expect(body.roles).toEqual(permissivePolicy.roles)
    expect(body.transitions).toEqual(permissivePolicy.transitions)
  })

  it('removes a stale edge (referencing a deleted column) via its chip', async () => {
    // Arrange — inject an edge whose `from` isn't a live lane key.
    const user = userEvent.setup()
    const withStale: PolicyDocument = {
      ...permissivePolicy,
      transitions: [...permissivePolicy.transitions, { from: 'ghost', to: 'intake' }],
    }
    const fake = mountEditor(withStale)

    // Act — the stale edge shows a removable chip labelled by its raw key.
    await user.click(
      await screen.findByRole('button', { name: 'Remove the move from ghost to Intake' }),
    )
    await user.click(screen.getByRole('button', { name: 'Save transitions' }))

    // Assert
    const body = fake.lastBody('PUT', '/api/v1/policy') as PolicyDocument
    expect(body.transitions).not.toContainEqual({ from: 'ghost', to: 'intake' })
  })

  it('flags a live column with no outgoing move while enforcement is on', async () => {
    // Arrange — enforcement on, but drop every edge out of `done`.
    const noDoneExit: PolicyDocument = {
      ...enforcedPolicy,
      transitions: enforcedPolicy.transitions.filter((edge) => edge.from !== 'done'),
    }

    // Act
    mountEditor(noDoneExit)

    // Assert — the advisory names the trapped column (Done).
    expect(await screen.findByText(/“Done” has no outgoing moves/)).toBeInTheDocument()
  })
})

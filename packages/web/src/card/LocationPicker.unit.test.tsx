import { type Location } from '@rivian-kanban/core'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { uid } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { LocationPicker } from './LocationPicker.tsx'

const building: Location = { id: uid(121), parentId: null, kind: 'building', name: 'HQ' }
const floor: Location = { id: uid(122), parentId: building.id, kind: 'floor', name: 'Floor 2' }
const room: Location = { id: uid(123), parentId: floor.id, kind: 'room', name: 'Room 204' }

describe('LocationPicker', () => {
  it('selects a nested node from the site tree', async () => {
    // Arrange
    const user = userEvent.setup()
    const changes: (string | null)[] = []
    renderWithProviders(
      <LocationPicker
        locations={[building, floor, room]}
        value={null}
        onChange={(next) => changes.push(next)}
      />,
    )
    // Act
    await user.click(screen.getByRole('textbox', { name: 'Location' }))
    await user.click(await screen.findByText('Room 204'))
    // Assert
    expect(changes).toEqual([room.id])
  })

  it('shows a provided error message', () => {
    // Arrange
    const locations = [building]
    // Act
    renderWithProviders(
      <LocationPicker
        locations={locations}
        value={null}
        onChange={() => undefined}
        error="Pick a location"
      />,
    )
    // Assert
    expect(screen.getByText('Pick a location')).toBeInTheDocument()
  })

  it('replaces an empty picker with a clear message + a Settings link', () => {
    // Arrange
    const noop = () => undefined
    // Act — no locations exist in the instance.
    renderWithProviders(<LocationPicker locations={[]} value={null} onChange={noop} />)
    // Assert — a disabled field says so and points to Settings, not a tiny empty box.
    expect(screen.getByPlaceholderText('No locations yet')).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument()
  })
})

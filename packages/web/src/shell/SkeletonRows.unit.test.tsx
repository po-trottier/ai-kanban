import { Table } from '@mantine/core'
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render.tsx'
import { SkeletonRows } from './SkeletonRows.tsx'

describe('SkeletonRows', () => {
  it('renders the requested rows × cols and one announceable loading status', () => {
    // Arrange
    const body = (
      <Table>
        <Table.Tbody>
          <SkeletonRows rows={2} cols={3} />
        </Table.Tbody>
      </Table>
    )
    // Act — a table body of ghost rows (2 rows, 3 columns).
    renderWithProviders(body)
    // Assert — the first row is the announceable status (its role="status"
    // overrides the implicit row role) carrying one cell per column; the
    // remaining ghost row keeps its row role, so 1 row + 1 status = 2 rows.
    const status = screen.getByRole('status', { name: 'Loading…' })
    expect(within(status).getAllByRole('cell')).toHaveLength(3)
    expect(screen.getAllByRole('row')).toHaveLength(1)
  })
})

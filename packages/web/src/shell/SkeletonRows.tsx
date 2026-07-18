import { Skeleton, Table } from '@mantine/core'
import { strings } from '../strings.ts'

/**
 * Ghost `<tr>`s for an admin table while its `GET` is in flight — preserves the
 * column layout instead of a blank body collapsing to zero height (or an
 * empty-state flashing before the data lands). One `role="status"` row carries
 * the announceable loading label; the rest are decorative.
 */
export function SkeletonRows({ rows = 3, cols }: { rows?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <Table.Tr
          key={row}
          {...(row === 0
            ? { role: 'status', 'aria-label': strings.common.loading, 'aria-busy': true }
            : {})}
        >
          {Array.from({ length: cols }, (_, col) => (
            <Table.Td key={col}>
              <Skeleton height="1.25rem" radius="sm" />
            </Table.Td>
          ))}
        </Table.Tr>
      ))}
    </>
  )
}

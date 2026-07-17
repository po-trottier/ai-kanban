import { Skeleton, Stack } from '@mantine/core'
import { LANE_KEYS } from '@rivian-kanban/core'
import { strings } from '../strings.ts'
import { SIZES } from '../theme.ts'
import classes from '../board/board.module.css'

/** Seven ghost lanes while `GET /board` is in flight. */
export function BoardSkeleton() {
  return (
    // role="status" makes aria-busy + the label announceable (not a bare div).
    <div className={classes.board} role="status" aria-label={strings.common.loading} aria-busy>
      {LANE_KEYS.map((key) => (
        <div key={key} className={classes.lane}>
          <Stack className={classes.laneCards} gap="xs">
            <Skeleton height={SIZES.skeletonLaneHeaderHeight} radius="md" />
            <Skeleton height={SIZES.skeletonCardHeight} radius="md" />
            <Skeleton height={SIZES.skeletonCardHeight} radius="md" />
          </Stack>
        </div>
      ))}
    </div>
  )
}

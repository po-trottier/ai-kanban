import { type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/types'

/**
 * The full ordered id list after dropping `sourceId` onto `targetId`'s given
 * edge (top = before, bottom = after) — the exact body `POST /lanes/reorder`
 * receives. Returns the same array reference on a no-op drop (source already in
 * place) so the caller can skip the request. Kept separate from the drag wiring
 * so the reorder logic is unit-testable without native HTML5 drag events (which
 * don't exist in happy-dom, docs/dev/testing.md). Insert-after-removal so the
 * index math is correct whether the source moves up or down.
 */
export function reorderedLaneIds(
  orderedIds: string[],
  sourceId: string,
  targetId: string,
  edge: Edge | null,
): string[] {
  if (sourceId === targetId) return orderedIds
  const without = orderedIds.filter((id) => id !== sourceId)
  const targetIndex = without.indexOf(targetId)
  if (targetIndex === -1 || without.length === orderedIds.length) return orderedIds
  const insertAt = edge === 'bottom' ? targetIndex + 1 : targetIndex
  const next = [...without.slice(0, insertAt), sourceId, ...without.slice(insertAt)]
  // An in-place drop (unchanged order) returns the same ref so the caller skips
  // the round-trip.
  return next.every((id, index) => id === orderedIds[index]) ? orderedIds : next
}

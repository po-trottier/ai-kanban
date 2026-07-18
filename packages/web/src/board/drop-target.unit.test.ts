import { attachClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { describe, expect, it } from 'vitest'
import { resolveDropTarget } from './move-options.ts'

describe('resolveDropTarget', () => {
  it('prefers the inner-most card target with its closest edge', () => {
    // Arrange
    const cardData = attachClosestEdge(
      { cardId: 1, laneKey: 'ready' },
      {
        element: document.createElement('div'),
        input: { clientX: 0, clientY: 0 } as never,
        allowedEdges: ['top', 'bottom'],
      },
    )
    const stack = [{ data: cardData }, { data: { laneKey: 'ready' } }]
    // Act
    const target = resolveDropTarget(stack)
    // Assert
    expect(target).toMatchObject({ laneKey: 'ready', overCardId: 1 })
  })

  it('falls back to the lane target for drops on empty lane space', () => {
    // Arrange
    const stack = [{ data: { laneKey: 'review' } }]
    // Act
    const target = resolveDropTarget(stack)
    // Assert
    expect(target).toEqual({ laneKey: 'review' })
  })

  it('returns null when nothing droppable was under the pointer', () => {
    // Arrange
    const stack = [{ data: {} }]
    // Act
    const target = resolveDropTarget(stack)
    // Assert
    expect(target).toBeNull()
  })
})

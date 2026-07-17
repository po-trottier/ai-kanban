import { describe, expect, it } from 'vitest'
import { makeCard, makeComment, uid } from '../test/fixtures.ts'
import { buildCommentThread } from './comments.ts'

describe('buildCommentThread', () => {
  it('groups replies under their parent, both levels oldest-first', () => {
    // Arrange
    const cardId = makeCard('intake').id
    const parentA = makeComment({ id: uid(11), cardId, createdAt: '2026-07-01T10:00:00.000Z' })
    const parentB = makeComment({ id: uid(12), cardId, createdAt: '2026-07-01T11:00:00.000Z' })
    const replyToA = makeComment({
      id: uid(13),
      cardId,
      parentCommentId: parentA.id,
      createdAt: '2026-07-01T12:00:00.000Z',
    })
    const earlierReplyToA = makeComment({
      id: uid(14),
      cardId,
      parentCommentId: parentA.id,
      createdAt: '2026-07-01T10:30:00.000Z',
    })
    // Act
    const thread = buildCommentThread([replyToA, parentB, parentA, earlierReplyToA])
    // Assert
    expect(thread.map((node) => node.comment.id)).toEqual([parentA.id, parentB.id])
    expect(thread[0]?.replies.map((reply) => reply.id)).toEqual([earlierReplyToA.id, replyToA.id])
    expect(thread[1]?.replies).toEqual([])
  })

  it('keeps soft-deleted comments in the thread (placeholders preserve context)', () => {
    // Arrange
    const cardId = makeCard('intake').id
    const deleted = makeComment({ id: uid(15), cardId, deletedAt: '2026-07-02T10:00:00.000Z' })
    const reply = makeComment({ id: uid(16), cardId, parentCommentId: deleted.id })
    // Act
    const thread = buildCommentThread([deleted, reply])
    // Assert
    expect(thread).toHaveLength(1)
    expect(thread[0]?.comment.deletedAt).not.toBeNull()
    expect(thread[0]?.replies.map((r) => r.id)).toEqual([reply.id])
  })
})

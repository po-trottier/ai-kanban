import { type Comment } from '@rivian-kanban/core'

export interface CommentThreadNode {
  comment: Comment
  replies: Comment[]
}

/**
 * One level of nesting (core rule: replies to a reply attach to the same
 * parent). Top-level and replies both oldest-first.
 */
export function buildCommentThread(comments: Comment[]): CommentThreadNode[] {
  const byCreation = comments.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
  const topLevel = byCreation.filter((comment) => comment.parentCommentId === null)
  return topLevel.map((comment) => ({
    comment,
    replies: byCreation.filter((candidate) => candidate.parentCommentId === comment.id),
  }))
}

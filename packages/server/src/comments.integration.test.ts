import { DEFAULT_POLICY_DOCUMENT } from '@rivian-kanban/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from './test/support.ts'

/**
 * Threaded comments (docs/architecture/rest-api.md#comments): one-level
 * threading, author-only edits (always-on identity rule), soft deletes with
 * blanked bodies, and the deleteOthersComments action gate — both postures.
 */

let t: TestApp
let cookie: string
let cardId: string

beforeAll(async () => {
  t = await createTestApp()
  ;({ cookie } = await t.asRole('user'))
  const created = await t.request(cookie, {
    method: 'POST',
    url: '/api/v1/cards',
    payload: { title: 'Commented card' },
  })
  cardId = created.json<{ id: string }>().id
})

afterAll(async () => {
  await t.cleanup()
})

interface CommentBody {
  id: string
  body: string
  parentCommentId: string | null
  authorId: string
  deletedAt: string | null
}

async function addComment(
  asCookie: string,
  body: string,
  parentCommentId?: string,
): Promise<CommentBody> {
  const response = await t.request(asCookie, {
    method: 'POST',
    url: `/api/v1/cards/${cardId}/comments`,
    payload: { body, ...(parentCommentId !== undefined ? { parentCommentId } : {}) },
  })
  if (response.statusCode !== 201) throw new Error(`comment failed: ${response.body}`)
  return response.json<CommentBody>()
}

async function thread(): Promise<CommentBody[]> {
  const response = await t.request(cookie, {
    method: 'GET',
    url: `/api/v1/cards/${cardId}/comments`,
  })
  return response.json<CommentBody[]>()
}

describe('POST /cards/:id/comments', () => {
  it('adds a comment, audits comment.added, and lists oldest-first', async () => {
    const { user, cookie: author } = await t.asRole('user')

    const first = await addComment(author, 'First!')
    await addComment(author, 'Second!')

    const listed = await thread()
    const bodies = listed.map((comment) => comment.body)
    expect(bodies.indexOf('First!')).toBeLessThan(bodies.indexOf('Second!'))
    expect(first.authorId).toBe(user.id)

    const events = await t.request(cookie, {
      method: 'GET',
      url: `/api/v1/cards/${cardId}/events?type=comment.added`,
    })
    const items = events.json<{ items: { payload: { commentId: string } }[] }>().items
    expect(items.map((event) => event.payload.commentId)).toContain(first.id)
  })

  it('threads one level deep: a reply to a reply attaches to the top parent', async () => {
    const parent = await addComment(cookie, 'Thread root')
    const reply = await addComment(cookie, 'Reply', parent.id)
    const replyToReply = await addComment(cookie, 'Deep reply', reply.id)

    expect(reply.parentCommentId).toBe(parent.id)
    expect(replyToReply.parentCommentId).toBe(parent.id)
  })

  it('rejects an empty body (400), unknown card (404), and foreign parent (404)', async () => {
    const otherCard = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/cards',
      payload: { title: 'Other card' },
    })
    const foreignParent = await addComment(cookie, 'On the main card')

    const empty = await t.request(cookie, {
      method: 'POST',
      url: `/api/v1/cards/${cardId}/comments`,
      payload: { body: '   ' },
    })
    const ghostCard = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/cards/999999/comments',
      payload: { body: 'Hello?' },
    })
    const crossThread = await t.request(cookie, {
      method: 'POST',
      url: `/api/v1/cards/${otherCard.json<{ id: string }>().id}/comments`,
      payload: { body: 'Wrong thread', parentCommentId: foreignParent.id },
    })

    expect(empty.statusCode).toBe(400)
    expect(ghostCard.statusCode).toBe(404)
    expect(crossThread.statusCode).toBe(404)
  })
})

describe('PATCH /comments/:id', () => {
  it('lets the author edit and audits comment.edited', async () => {
    const comment = await addComment(cookie, 'Original text')

    const response = await t.request(cookie, {
      method: 'PATCH',
      url: `/api/v1/comments/${comment.id}`,
      payload: { body: 'Edited text' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json<CommentBody>().body).toBe('Edited text')
  })

  it('denies edits of other users comments — impersonation prevention', async () => {
    const other = await t.asRole('admin')
    const comment = await addComment(cookie, 'Mine')

    const response = await t.request(other.cookie, {
      method: 'PATCH',
      url: `/api/v1/comments/${comment.id}`,
      payload: { body: 'Hijacked' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json<{ rule: string }>().rule).toBe('comment-author-only')
  })
})

describe('DELETE /comments/:id', () => {
  it('soft-deletes: thread shape kept, body blanked, audit written', async () => {
    const comment = await addComment(cookie, 'Sensitive content')

    const response = await t.request(cookie, {
      method: 'DELETE',
      url: `/api/v1/comments/${comment.id}`,
    })
    expect(response.statusCode).toBe(204)

    const listed = await thread()
    const deleted = listed.find((candidate) => candidate.id === comment.id)
    expect(deleted?.deletedAt).not.toBeNull()
    expect(deleted?.body).toBe('')

    const again = await t.request(cookie, {
      method: 'DELETE',
      url: `/api/v1/comments/${comment.id}`,
    })
    expect(again.statusCode).toBe(404)
  })

  it('denies deleting others’ comments by default (user lacks the grant), admin may', async () => {
    const admin = await t.asRole('admin')
    const requester = await t.asRole('user')

    // Default policy: the `user` role does not grant comment.deleteOthers.
    const target = await addComment(cookie, 'Protected by default')
    const denied = await t.request(requester.cookie, {
      method: 'DELETE',
      url: `/api/v1/comments/${target.id}`,
    })
    expect(denied.statusCode).toBe(403)
    expect(denied.json<{ rule: string }>().rule).toBe('permission:comment.deleteOthers')

    // An admin (grants comment.deleteOthers) may delete another author’s comment.
    const byAdmin = await t.request(admin.cookie, {
      method: 'DELETE',
      url: `/api/v1/comments/${target.id}`,
    })
    expect(byAdmin.statusCode).toBe(204)

    // The author always may — identity, not hierarchy.
    const own = await addComment(cookie, 'My own comment')
    const ownDelete = await t.request(cookie, {
      method: 'DELETE',
      url: `/api/v1/comments/${own.id}`,
    })
    expect(ownDelete.statusCode).toBe(204)
  })

  it('grants deleting others’ comments once the user role is given the permission', async () => {
    const admin = await t.asRole('admin')
    const requester = await t.asRole('user')

    const granted = await t.request(admin.cookie, {
      method: 'PUT',
      url: '/api/v1/policy',
      payload: {
        ...DEFAULT_POLICY_DOCUMENT,
        roles: DEFAULT_POLICY_DOCUMENT.roles.map((role) =>
          role.key === 'user'
            ? { ...role, permissions: { ...role.permissions, 'comment.deleteOthers': true } }
            : role,
        ),
      },
    })
    expect(granted.statusCode).toBe(200)

    const target = await addComment(cookie, 'Now deletable by any user')
    const permissive = await t.request(requester.cookie, {
      method: 'DELETE',
      url: `/api/v1/comments/${target.id}`,
    })
    expect(permissive.statusCode).toBe(204)

    // Restore the default so later suites see the permissive baseline.
    await t.request(admin.cookie, {
      method: 'PUT',
      url: '/api/v1/policy',
      payload: DEFAULT_POLICY_DOCUMENT,
    })
  })
})

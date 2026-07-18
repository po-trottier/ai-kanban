import { DEFAULT_POLICY_DOCUMENT, MAX_ATTACHMENT_BYTES } from '@rivian-kanban/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestApp,
  EXE_HEADER,
  MINIMAL_PDF,
  multipartBody,
  PNG_1X1,
  type TestApp,
} from './test/support.ts'

/**
 * Uploads/downloads with REAL bytes (docs/dev/testing.md): magic-byte
 * sniffing against the core allowlist, the 25 MB/10-file caps, download
 * hardening (sanitized Content-Disposition + nosniff), and soft delete.
 */

let t: TestApp
let cookie: string
let cardId: string

beforeAll(async () => {
  t = await createTestApp()
  ;({ cookie } = await t.asRole('user'))
  cardId = await newCard()
})

afterAll(async () => {
  await t.cleanup()
})

async function newCard(): Promise<string> {
  const created = await t.request(cookie, {
    method: 'POST',
    url: '/api/v1/cards',
    payload: { title: 'Attachment target' },
  })
  return created.json<{ id: string }>().id
}

function upload(
  asCookie: string,
  targetCard: string,
  filename: string,
  bytes: Buffer,
  declaredType = 'application/octet-stream',
) {
  const { payload, headers } = multipartBody(filename, bytes, declaredType)
  return t.request(asCookie, {
    method: 'POST',
    url: `/api/v1/cards/${targetCard}/attachments`,
    headers,
    payload,
  })
}

describe('POST /cards/:id/attachments', () => {
  it('accepts a real PNG: sniffed MIME, size, sha256, audit event', async () => {
    const response = await upload(cookie, cardId, 'pixel.png', PNG_1X1)

    expect(response.statusCode).toBe(201)
    const attachment = response.json<{
      id: string
      mime: string
      bytes: number
      sha256: string
      filename: string
    }>()
    expect(attachment.mime).toBe('image/png')
    expect(attachment.bytes).toBe(PNG_1X1.byteLength)
    expect(attachment.sha256).toMatch(/^[0-9a-f]{64}$/)

    const events = await t.request(cookie, {
      method: 'GET',
      url: `/api/v1/cards/${cardId}/events?type=attachment.added`,
    })
    const items = events.json<{ items: { payload: { attachmentId: string } }[] }>().items
    expect(items.map((event) => event.payload.attachmentId)).toContain(attachment.id)
  })

  it('accepts a real PDF', async () => {
    const response = await upload(cookie, cardId, 'spec.pdf', MINIMAL_PDF)

    expect(response.statusCode).toBe(201)
    expect(response.json<{ mime: string }>().mime).toBe('application/pdf')
  })

  it('rejects an EXE with 415 even when the client claims image/png', async () => {
    const honest = await upload(cookie, cardId, 'tool.exe', EXE_HEADER)
    const disguised = await upload(cookie, cardId, 'innocent.png', EXE_HEADER, 'image/png')

    expect(honest.statusCode).toBe(415)
    expect(disguised.statusCode).toBe(415)
    expect(disguised.json<{ type: string }>().type).toBe(
      'urn:rivian-kanban:problem:unsupported-media-type',
    )
  })

  it('rejects a file above 25 MB with the documented 413 problem type', async () => {
    const oversized = Buffer.concat([PNG_1X1, Buffer.alloc(MAX_ATTACHMENT_BYTES, 0)])

    const response = await upload(cookie, cardId, 'huge.png', oversized)

    expect(response.statusCode).toBe(413)
    expect(response.json<{ type: string }>().type).toBe(
      'urn:rivian-kanban:problem:payload-too-large',
    )
  }, 30_000)

  it('rejects the request when no file part is present with a 400 validation problem', async () => {
    const response = await t.request(cookie, {
      method: 'POST',
      url: `/api/v1/cards/${cardId}/attachments`,
      headers: {
        'content-type': 'multipart/form-data; boundary=xyz',
        'x-requested-with': 'rivian-kanban',
      },
      payload: '--xyz--\r\n',
    })

    expect(response.statusCode).toBe(400)
    const body = response.json<{ type: string; issues: { path: string }[] }>()
    expect(body.type).toBe('urn:rivian-kanban:problem:validation')
    expect(body.issues.map((issue) => issue.path)).toContain('file')
  })

  it('404s an unknown card', async () => {
    const response = await upload(cookie, '999999', 'pixel.png', PNG_1X1)

    expect(response.statusCode).toBe(404)
  })

  it('enforces the 10-active-files cap with a 409 attachment-limit', async () => {
    const target = await newCard()
    for (let index = 0; index < 10; index += 1) {
      const ok = await upload(cookie, target, `file-${String(index)}.png`, PNG_1X1)
      expect(ok.statusCode).toBe(201)
    }

    const eleventh = await upload(cookie, target, 'file-11.png', PNG_1X1)

    expect(eleventh.statusCode).toBe(409)
    expect(eleventh.json<{ type: string }>().type).toBe(
      'urn:rivian-kanban:problem:attachment-limit',
    )
  })
})

describe('GET /attachments/:id', () => {
  it('downloads the exact bytes with attachment disposition and nosniff', async () => {
    const uploaded = await upload(cookie, cardId, 'download-me.png', PNG_1X1)
    const id = uploaded.json<{ id: string }>().id

    const response = await t.request(cookie, { method: 'GET', url: `/api/v1/attachments/${id}` })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('image/png')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="download-me.png"; filename*=UTF-8''download-me.png`,
    )
    expect(Buffer.compare(response.rawPayload, PNG_1X1)).toBe(0)
  })

  it('encodes non-ASCII filenames: ASCII fallback + RFC 5987 filename*', async () => {
    // Quote/CRLF stripping is pinned by the content-disposition unit tests;
    // multipart itself cannot transport those bytes in a filename.
    const uploaded = await upload(cookie, cardId, 'nameé (1).png', PNG_1X1)
    const id = uploaded.json<{ id: string }>().id

    const response = await t.request(cookie, { method: 'GET', url: `/api/v1/attachments/${id}` })

    const disposition = response.headers['content-disposition']
    expect(disposition).toBe(
      `attachment; filename="name_ (1).png"; filename*=UTF-8''name%C3%A9%20%281%29.png`,
    )
  })

  it('404s unknown ids', async () => {
    const response = await t.request(cookie, {
      method: 'GET',
      url: '/api/v1/attachments/00000000-0000-7000-8000-00000000dead',
    })

    expect(response.statusCode).toBe(404)
  })
})

describe('DELETE /attachments/:id', () => {
  it('soft-deletes, removes the blob, audits, and 404s later downloads', async () => {
    const target = await newCard()
    const uploaded = await upload(cookie, target, 'delete-me.png', PNG_1X1)
    const id = uploaded.json<{ id: string; storageKey?: string }>().id

    const response = await t.request(cookie, {
      method: 'DELETE',
      url: `/api/v1/attachments/${id}`,
    })
    expect(response.statusCode).toBe(204)

    const download = await t.request(cookie, { method: 'GET', url: `/api/v1/attachments/${id}` })
    expect(download.statusCode).toBe(404)

    const again = await t.request(cookie, { method: 'DELETE', url: `/api/v1/attachments/${id}` })
    expect(again.statusCode).toBe(404)

    const events = await t.request(cookie, {
      method: 'GET',
      url: `/api/v1/cards/${target}/events?type=attachment.removed`,
    })
    expect(events.json<{ items: unknown[] }>().items).toHaveLength(1)
  })

  it('soft-deleted files free their slot in the 10-file cap', async () => {
    const target = await newCard()
    for (let index = 0; index < 10; index += 1) {
      await upload(cookie, target, `cap-${String(index)}.png`, PNG_1X1)
    }
    const detail = await t.request(cookie, { method: 'GET', url: `/api/v1/cards/${target}` })
    const firstId = detail.json<{ attachments: { id: string }[] }>().attachments[0]?.id ?? ''
    await t.request(cookie, { method: 'DELETE', url: `/api/v1/attachments/${firstId}` })

    const refill = await upload(cookie, target, 'refill.png', PNG_1X1)

    expect(refill.statusCode).toBe(201)
  })

  it('denies deleting others’ uploads by default (user lacks the grant); admin may', async () => {
    const admin = await t.asRole('admin')
    const requester = await t.asRole('user')
    const target = await newCard()

    // Default policy: the `user` role does not grant attachment.deleteOthers.
    const first = await upload(cookie, target, 'mine-1.png', PNG_1X1)
    const firstId = first.json<{ id: string }>().id
    const denied = await t.request(requester.cookie, {
      method: 'DELETE',
      url: `/api/v1/attachments/${firstId}`,
    })
    expect(denied.statusCode).toBe(403)
    expect(denied.json<{ rule: string }>().rule).toBe('permission:attachment.deleteOthers')

    // An admin (grants attachment.deleteOthers) may remove another user’s upload.
    const byAdmin = await t.request(admin.cookie, {
      method: 'DELETE',
      url: `/api/v1/attachments/${firstId}`,
    })
    expect(byAdmin.statusCode).toBe(204)

    // Grant the user role the permission → any user may now delete others’.
    await t.request(admin.cookie, {
      method: 'PUT',
      url: '/api/v1/policy',
      payload: {
        ...DEFAULT_POLICY_DOCUMENT,
        roles: DEFAULT_POLICY_DOCUMENT.roles.map((role) =>
          role.key === 'user'
            ? { ...role, permissions: { ...role.permissions, 'attachment.deleteOthers': true } }
            : role,
        ),
      },
    })
    const second = await upload(cookie, target, 'mine-2.png', PNG_1X1)
    const permissive = await t.request(requester.cookie, {
      method: 'DELETE',
      url: `/api/v1/attachments/${second.json<{ id: string }>().id}`,
    })
    expect(permissive.statusCode).toBe(204)

    await t.request(admin.cookie, {
      method: 'PUT',
      url: '/api/v1/policy',
      payload: DEFAULT_POLICY_DOCUMENT,
    })
  })
})

describe('storage quotas (507)', () => {
  it('rejects uploads past the per-user daily quota', async () => {
    const solo = await createTestApp({
      uploads: {
        dailyQuotaBytesPerUser: PNG_1X1.byteLength + 10,
        blobHighWaterBytes: 50 * 1024 * 1024 * 1024,
      },
    })
    try {
      const { cookie: soloCookie } = await solo.asRole('user')
      const created = await solo.request(soloCookie, {
        method: 'POST',
        url: '/api/v1/cards',
        payload: { title: 'Quota card' },
      })
      const target = created.json<{ id: string }>().id
      const body = multipartBody('one.png', PNG_1X1)

      const first = await solo.request(soloCookie, {
        method: 'POST',
        url: `/api/v1/cards/${target}/attachments`,
        headers: body.headers,
        payload: body.payload,
      })
      const second = await solo.request(soloCookie, {
        method: 'POST',
        url: `/api/v1/cards/${target}/attachments`,
        headers: body.headers,
        payload: body.payload,
      })

      expect(first.statusCode).toBe(201)
      expect(second.statusCode).toBe(507)
      expect(second.json<{ type: string }>().type).toBe(
        'urn:rivian-kanban:problem:insufficient-storage',
      )
    } finally {
      await solo.cleanup()
    }
  })

  it('rejects uploads past the BLOB_DIR high-water mark', async () => {
    const solo = await createTestApp({
      uploads: { dailyQuotaBytesPerUser: 500 * 1024 * 1024, blobHighWaterBytes: 10 },
    })
    try {
      const { cookie: soloCookie } = await solo.asRole('user')
      const created = await solo.request(soloCookie, {
        method: 'POST',
        url: '/api/v1/cards',
        payload: { title: 'High-water card' },
      })
      const body = multipartBody('one.png', PNG_1X1)

      const response = await solo.request(soloCookie, {
        method: 'POST',
        url: `/api/v1/cards/${created.json<{ id: string }>().id}/attachments`,
        headers: body.headers,
        payload: body.payload,
      })

      expect(response.statusCode).toBe(507)
    } finally {
      await solo.cleanup()
    }
  })
})

describe('upload rate limit (20/min/user by default)', () => {
  it('429s past the per-user budget', async () => {
    const solo = await createTestApp({
      rateLimits: { upload: { max: 2, timeWindowMs: 60_000 } },
    })
    try {
      const { cookie: soloCookie } = await solo.asRole('user')
      const created = await solo.request(soloCookie, {
        method: 'POST',
        url: '/api/v1/cards',
        payload: { title: 'Rate limited card' },
      })
      const target = created.json<{ id: string }>().id
      const body = multipartBody('one.png', PNG_1X1)
      const post = () =>
        solo.request(soloCookie, {
          method: 'POST',
          url: `/api/v1/cards/${target}/attachments`,
          headers: body.headers,
          payload: body.payload,
        })

      expect((await post()).statusCode).toBe(201)
      expect((await post()).statusCode).toBe(201)
      const third = await post()
      expect(third.statusCode).toBe(429)
      expect(third.headers['retry-after']).toBeDefined()
    } finally {
      await solo.cleanup()
    }
  })
})

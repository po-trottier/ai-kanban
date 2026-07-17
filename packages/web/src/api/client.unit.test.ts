import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createFakeFetch, jsonResponse, problemResponse } from '../test/fake-fetch.ts'
import { ApiClient, buildUrl } from './client.ts'

describe('buildUrl', () => {
  it('prefixes the API base and appends defined query params', () => {
    // Arrange
    const query = { cursor: 'abc', limit: 50, skip: undefined }
    // Act
    const url = buildUrl('/cards', query)
    // Assert
    expect(url).toBe('/api/v1/cards?cursor=abc&limit=50')
  })

  it('omits the query string when no params are defined', () => {
    // Arrange
    const path = '/board'
    // Act
    const url = buildUrl(path)
    // Assert
    expect(url).toBe('/api/v1/board')
  })
})

describe('ApiClient', () => {
  it('parses response bodies through the provided schema', async () => {
    // Arrange
    const fake = createFakeFetch({ 'GET /api/v1/thing': { value: 7 } })
    const client = new ApiClient(fake.fetch)
    // Act
    const result = await client.get('/thing', z.object({ value: z.number() }))
    // Assert
    expect(result).toEqual({ value: 7 })
  })

  it('sends If-Match as a quoted version and a JSON body (ADR-012)', async () => {
    // Arrange
    const fake = createFakeFetch({ 'POST /api/v1/cards/c1/move': { ok: true } })
    const client = new ApiClient(fake.fetch)
    // Act
    await client.post('/cards/c1/move', z.object({ ok: z.boolean() }), {
      body: { toLane: 'ready' },
      ifMatch: 4,
    })
    // Assert
    const call = fake.calls[0]
    expect(new Headers(call?.init?.headers).get('If-Match')).toBe('"4"')
    expect(new Headers(call?.init?.headers).get('Content-Type')).toBe('application/json')
    expect(fake.lastBody('POST', '/api/v1/cards/c1/move')).toEqual({ toLane: 'ready' })
  })

  it('marks bodyless mutations with X-Requested-With (CSRF layer 2)', async () => {
    // Arrange
    const fake = createFakeFetch({
      'DELETE /api/v1/comments/c1': new Response(null, { status: 204 }),
    })
    const client = new ApiClient(fake.fetch)
    // Act
    await client.deleteVoid('/comments/c1')
    // Assert
    const call = fake.calls[0]
    expect(new Headers(call?.init?.headers).get('X-Requested-With')).toBe('rivian-kanban')
  })

  it('throws an ApiError carrying the problem+json document on non-2xx', async () => {
    // Arrange
    const fake = createFakeFetch({
      'GET /api/v1/board': problemResponse(403, { title: 'Forbidden', rule: 'cancel' }),
    })
    const client = new ApiClient(fake.fetch)
    // Act
    const attempt = client.get('/board', z.unknown())
    // Assert
    await expect(attempt).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      problem: { title: 'Forbidden', rule: 'cancel' },
    })
  })

  it('falls back to a bare status problem when the error body is not JSON', async () => {
    // Arrange
    const fake = createFakeFetch({
      'GET /api/v1/board': new Response('<html>bad gateway</html>', { status: 502 }),
    })
    const client = new ApiClient(fake.fetch)
    // Act
    const attempt = client.get('/board', z.unknown())
    // Assert
    await expect(attempt).rejects.toMatchObject({ status: 502, problem: { status: 502 } })
  })

  it('rejects responses that do not match the schema (single-schema rule)', async () => {
    // Arrange
    const fake = createFakeFetch({ 'GET /api/v1/thing': jsonResponse({ value: 'nope' }) })
    const client = new ApiClient(fake.fetch)
    // Act
    const attempt = client.get('/thing', z.object({ value: z.number() }))
    // Assert
    await expect(attempt).rejects.toThrow()
  })
})

import {
  ArchivedError,
  ConflictError,
  IllegalTransitionError,
  LimitExceededError,
  MAX_ACTIVE_ATTACHMENTS_PER_CARD,
  MAX_ATTACHMENT_BYTES,
  NotFoundError,
  PolicyDeniedError,
} from '@rivian-kanban/core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  BackoffActiveError,
  CsrfError,
  InvalidCredentialsError,
  LastActiveAdminError,
  MustChangePasswordError,
  SetupAlreadyCompleteError,
  StorageQuotaError,
  UnauthenticatedError,
  UnsupportedMediaTypeError,
} from '../errors.ts'
import { toProblem } from './problems.ts'

describe('toProblem — core domain errors', () => {
  it('maps ZodError to 400 with an issues array', () => {
    // Arrange
    const result = z.strictObject({ title: z.string() }).safeParse({})
    if (result.success) throw new Error('expected a validation failure')

    // Act
    const problem = toProblem(result.error)

    // Assert
    expect(problem.status).toBe(400)
    expect(problem.body.type).toBe('urn:rivian-kanban:problem:validation')
    expect(problem.body.issues).toMatchObject([{ path: 'title' }])
  })

  it('maps PolicyDeniedError to 403 naming the rule', () => {
    // Arrange
    const error = new PolicyDeniedError('permission:card.cancel')

    // Act
    const problem = toProblem(error)

    // Assert
    expect(problem.status).toBe(403)
    expect(problem.body.rule).toBe('permission:card.cancel')
  })

  it('maps IllegalTransitionError to 422 with from and to', () => {
    // Arrange
    const error = new IllegalTransitionError('intake', 'done')

    // Act
    const problem = toProblem(error)

    // Assert
    expect(problem.status).toBe(422)
    expect(problem.body).toMatchObject({ from: 'intake', to: 'done' })
  })

  it('maps ConflictError to 409 carrying the current resource when present', () => {
    // Arrange
    const current = { id: 'card-1', version: 4 }
    const withCurrent = new ConflictError('stale expectedVersion', current as never)
    const without = new ConflictError('email already in use')

    // Act
    const problemWith = toProblem(withCurrent)
    const problemWithout = toProblem(without)

    // Assert
    expect(problemWith.status).toBe(409)
    expect(problemWith.body.current).toEqual(current)
    expect(problemWithout.body.current).toBeUndefined()
  })

  it('maps ArchivedError to 409 card-archived and NotFoundError to 404', () => {
    // Arrange
    const archived = new ArchivedError()
    const missing = new NotFoundError('card')

    // Act
    const archivedProblem = toProblem(archived)
    const missingProblem = toProblem(missing)

    // Assert
    expect(archivedProblem.status).toBe(409)
    expect(archivedProblem.body.type).toBe('urn:rivian-kanban:problem:card-archived')
    expect(missingProblem.status).toBe(404)
  })

  it('splits LimitExceededError: file size 413, attachment count 409', () => {
    // Arrange
    const size = new LimitExceededError('too big', MAX_ATTACHMENT_BYTES)
    const count = new LimitExceededError('too many', MAX_ACTIVE_ATTACHMENTS_PER_CARD)

    // Act
    const sizeProblem = toProblem(size)
    const countProblem = toProblem(count)

    // Assert
    expect(sizeProblem.status).toBe(413)
    expect(countProblem.status).toBe(409)
    expect(countProblem.body.type).toBe('urn:rivian-kanban:problem:attachment-limit')
  })
})

describe('toProblem — server-surface errors', () => {
  it('maps auth errors: 401 uniform, 403 gates, 429 backoff with Retry-After', () => {
    // Arrange
    const unauthenticated = toProblem(new UnauthenticatedError())
    const invalidCredentials = toProblem(new InvalidCredentialsError())

    // Act
    const backoff = toProblem(new BackoffActiveError(17))
    const mustChange = toProblem(new MustChangePasswordError())

    // Assert
    expect(unauthenticated.status).toBe(401)
    expect(invalidCredentials.body.type).toBe(unauthenticated.body.type)
    expect(backoff.status).toBe(429)
    expect(backoff.headers).toEqual({ 'retry-after': '17' })
    expect(mustChange.status).toBe(403)
  })

  it('maps CSRF 403, media type 415, quota 507, last-admin 409', () => {
    // Arrange
    const errors = {
      csrf: new CsrfError(),
      mediaType: new UnsupportedMediaTypeError('application/x-msdownload'),
      quota: new StorageQuotaError('full'),
      lastAdmin: new LastActiveAdminError(),
    }

    // Act
    const csrf = toProblem(errors.csrf)
    const mediaType = toProblem(errors.mediaType)
    const quota = toProblem(errors.quota)
    const lastAdmin = toProblem(errors.lastAdmin)

    // Assert
    expect(csrf.status).toBe(403)
    expect(mediaType.status).toBe(415)
    expect(quota.status).toBe(507)
    expect(lastAdmin.status).toBe(409)
    expect(lastAdmin.body.rule).toBe('last-active-admin')
  })

  it('maps SetupAlreadyCompleteError to the documented 409 problem type', () => {
    // Arrange
    const error = new SetupAlreadyCompleteError()

    // Act
    const result = toProblem(error)

    // Assert
    expect(result.status).toBe(409)
    expect(result.body.type).toBe('urn:rivian-kanban:problem:setup-already-complete')
  })

  it('preserves framework HTTP errors but sanitizes 5xx and unknowns', () => {
    // Arrange
    const framework = Object.assign(new Error('Unsupported Media Type'), { statusCode: 415 })
    const crash = Object.assign(new Error('secret stack details'), { statusCode: 500 })
    const unknown = new Error('database exploded at C:\\secrets')

    // Act
    const frameworkProblem = toProblem(framework)
    const crashProblem = toProblem(crash)
    const unknownProblem = toProblem(unknown)

    // Assert
    expect(frameworkProblem.status).toBe(415)
    expect(crashProblem.body.detail).toBeUndefined()
    expect(unknownProblem.status).toBe(500)
    expect(JSON.stringify(unknownProblem.body)).not.toContain('secrets')
  })
})

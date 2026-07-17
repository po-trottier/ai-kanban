import { createHash } from 'node:crypto'
import { ALLOWED_ATTACHMENT_MIME_TYPES, NotFoundError } from '@rivian-kanban/core'
import { type FastifyInstance } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { fileTypeFromBuffer } from 'file-type'
import { RequestValidationError, StorageQuotaError, UnsupportedMediaTypeError } from '../errors.ts'
import { contentDispositionAttachment } from '../http/content-disposition.ts'
import { type UploadQuota } from '../uploads/upload-quota.ts'
import { type AppDeps } from '../types.ts'
import { actorOf } from './user-routes.ts'
import { attachmentResponseSchema, emptyBodySchema, idParamsSchema } from './schemas.ts'

/**
 * Attachments (docs/architecture/rest-api.md#attachments, security.md#uploads):
 * exactly one multipart part named `file`; MIME sniffed from magic bytes
 * against the core allowlist (client headers and extensions are ignored);
 * 25 MB/file (413), 10 active/card (409), 500 MB/day/user + BLOB_DIR
 * high-water (507). The server never decodes uploaded bytes.
 */
export function attachmentRoutes(deps: AppDeps, quota: UploadQuota) {
  return function routes(app: FastifyInstance): void {
    const r = app.withTypeProvider<ZodTypeProvider>()
    const { attachments } = deps.services
    const allowedMimes: readonly string[] = ALLOWED_ATTACHMENT_MIME_TYPES

    r.post(
      '/cards/:id/attachments',
      {
        config: {
          multipart: true,
          rateLimit: {
            max: deps.config.rateLimits.upload.max,
            timeWindow: deps.config.rateLimits.upload.timeWindowMs,
            keyGenerator: (request) => request.authUser?.id ?? request.ip,
          },
        },
        schema: {
          params: idParamsSchema,
          response: { 201: attachmentResponseSchema },
        },
      },
      async (request, reply) => {
        const actor = actorOf(request)
        const part = await request.file()
        if (part?.fieldname !== 'file') {
          throw new RequestValidationError('file', 'exactly one file part named "file" required')
        }
        // Buffers up to the 25 MB cap; past it @fastify/multipart throws 413.
        const content = await part.toBuffer()

        const sniffed = await fileTypeFromBuffer(content)
        const mime = sniffed?.mime ?? 'application/octet-stream'
        if (!allowedMimes.includes(mime)) throw new UnsupportedMediaTypeError(mime)

        // Reserve-then-settle: both quotas count these bytes atomically NOW
        // so concurrent uploads cannot all pass a check before any records
        // (TOCTOU); reservations are refunded when the upload fails below.
        if (!quota.reserve(actor.id, content.byteLength)) {
          throw new StorageQuotaError('daily upload quota exceeded — retry tomorrow')
        }
        if (!deps.blobStore.reserve(content.byteLength, deps.config.uploads.blobHighWaterBytes)) {
          quota.release(actor.id, content.byteLength)
          throw new StorageQuotaError('attachment storage is full — contact an administrator')
        }
        let attachment
        try {
          // The Buffer IS a Uint8Array and part.toBuffer() already returns a
          // standalone copy — re-wrapping in new Uint8Array(content) would
          // duplicate up to 25 MB of transient memory per in-flight upload.
          attachment = await attachments.add(actor, request.params.id, {
            filename: part.filename,
            mime,
            content,
            sha256: createHash('sha256').update(content).digest('hex'),
          })
        } catch (error) {
          quota.release(actor.id, content.byteLength)
          throw error
        } finally {
          // Settle the global reservation: on success the store counted the
          // bytes into its total at put(); on failure nothing was written.
          deps.blobStore.release(content.byteLength)
        }
        return reply.code(201).send(attachment)
      },
    )

    r.get(
      '/attachments/:id',
      {
        config: { rawResponse: true },
        schema: { params: idParamsSchema },
      },
      async (request, reply) => {
        const attachment = await attachments.getActive(request.params.id)
        // Streamed, never buffered: 25 MB x concurrent downloads must not
        // become transient process memory. Length comes from the metadata row
        // (the blob was written once with exactly these bytes).
        const stream = await deps.blobStore.getStream(attachment.storageKey)
        if (stream === null) throw new NotFoundError('attachment blob')
        return reply
          .header('content-disposition', contentDispositionAttachment(attachment.filename))
          .header('x-content-type-options', 'nosniff')
          .header('content-length', String(attachment.bytes))
          .type(attachment.mime)
          .send(stream)
      },
    )

    r.delete(
      '/attachments/:id',
      {
        config: { bodyless: true },
        schema: {
          params: idParamsSchema,
          response: { 204: emptyBodySchema },
        },
      },
      async (request, reply) => {
        await attachments.remove(actorOf(request), request.params.id)
        await reply.code(204).send(null)
      },
    )
  }
}

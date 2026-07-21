import {
  registerClientRequestSchema,
  type Clock,
  type IdGenerator,
  type OAuthClient,
  type RegisterClientResponse,
  type UnitOfWork,
} from '@rivian-kanban/core'
import { OAuthError } from './oauth-errors.ts'
import { isLoopbackRedirectUri } from './redirect-match.ts'

/**
 * RFC 7591 dynamic client registration (ADR-021 §B) — OPEN, no auth: an agent
 * gets a `client_id` with no human pre-registration. The consent screen (slice
 * 4), NOT registration, is the trust gate. Every redirect URI must be HTTPS or
 * loopback (OAuth 2.1 / RFC 8252) — no other scheme is registrable.
 */

export interface RegistrationServiceDeps {
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
}

/** A redirect URI is registrable iff it is HTTPS or a loopback `http://` URI. */
function isRegistrableRedirectUri(uri: string): boolean {
  if (isLoopbackRedirectUri(uri)) return true
  try {
    return new URL(uri).protocol === 'https:'
  } catch {
    return false
  }
}

export class RegistrationService {
  private readonly deps: RegistrationServiceDeps

  constructor(deps: RegistrationServiceDeps) {
    this.deps = deps
  }

  /**
   * Validates and persists a public client, returning the RFC 7591 response.
   * Rejects any non-HTTPS, non-loopback redirect URI (`invalid_redirect_uri`).
   */
  async register(rawInput: unknown): Promise<RegisterClientResponse> {
    const input = registerClientRequestSchema.parse(rawInput)
    for (const uri of input.redirect_uris) {
      if (!isRegistrableRedirectUri(uri)) {
        throw new OAuthError(
          'invalid_redirect_uri',
          `redirect_uri must be https or loopback: ${uri}`,
        )
      }
    }
    const client: OAuthClient = {
      id: this.deps.ids.newId(),
      name: input.client_name ?? 'OAuth client',
      redirectUris: input.redirect_uris,
      createdAt: this.deps.clock.now().toISOString(),
    }
    await this.deps.uow.run((tx) => tx.oauthClients.insert(client))
    return {
      client_id: client.id,
      redirect_uris: client.redirectUris,
      ...(input.client_name !== undefined ? { client_name: input.client_name } : {}),
      token_endpoint_auth_method: 'none',
    }
  }
}

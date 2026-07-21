import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { type CallToolResult, type ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import {
  activityFeedRequestSchema,
  activityFeedSchemaOf,
  activityUserSchema,
  addCommentInputSchema,
  archiveCardInputSchema,
  attachmentSchema,
  blockCardInputSchema,
  boardCardSchema,
  cancelCardInputSchema,
  cardDetailSchemaOf,
  cardEventSchema,
  cardHistoryRequestSchema,
  cardSchema,
  commentSchema,
  createCardInputSchema,
  isoDateTimeSchema,
  laneSchema,
  listCardsFilterSchema,
  locationSchema,
  moveCardInputSchema,
  NotFoundError,
  pageRequestSchema,
  pageSchemaOf,
  PolicyDeniedError,
  READ_SCOPE_RULE,
  redactedCommentSchema,
  reopenCardInputSchema,
  serviceTokenSchema,
  STALE_REASONS,
  staleCardsInputSchema,
  tagSchema,
  unblockCardInputSchema,
  updateCardInputSchema,
  type Actor,
  type BoardCard,
  type Lane,
} from '@rivian-kanban/core'
import { type FastifyBaseLogger } from 'fastify'
import { z } from 'zod'
import { toProblem } from '../http/problems.ts'
import { type AppDeps } from '../types.ts'

/**
 * The 20 MCP tools (docs/architecture/mcp.md#tools). Handlers call the same
 * core services as REST with the token-derived Actor, so policy and audit
 * behave identically. Input schemas are the core command/filter schemas
 * (single-schema rule) extended only with the tool-addressing fields REST
 * carries in the URL (`cardId`) or resolves from the session
 * (`reporterEmail`); output schemas compose the same core entity schemas, so
 * both directions are exposed to clients as JSON Schema. Domain errors
 * become problem-shaped tool errors via the same RFC 9457 mapper as REST —
 * rule names, conflict state and transition edges survive the transport
 * intact.
 */

const cardIdShape = { cardId: z.number().int().positive() }

const listCardsToolSchema = listCardsFilterSchema.extend(pageRequestSchema.shape)
const getCardToolSchema = z.strictObject(cardIdShape)
const cardHistoryToolSchema = cardHistoryRequestSchema.extend(cardIdShape)

/**
 * Enrich every history event with server-derived attribution IN PLACE. Core's
 * `cardEventSchema` already owns `actorLabel` (the stored OAuth client name for
 * `agent` events / the service-token name overlaid for `mcp`); the enrichment
 * fields below (`onBehalfOfUserId`, and for the activity feed the display-name
 * companions) are layered on per branch.
 *
 * We must EXTEND each strict branch, not `z.intersection(cardEventSchema, {…})`:
 * the intersection compiles to `allOf: [oneOf[…strict branches…], {…}]`, and the
 * MCP SDK's strict output validation then rejects the enrichment fields as
 * unexpected properties on the matched branch — a failure that only surfaces
 * once an event actually carries `onBehalfOfUserId` (i.e. mcp/agent events).
 * Extending keeps one strict object per event type that lists the fields itself.
 */
function enrichedEventSchema<Shape extends z.ZodRawShape>(extra: Shape) {
  const branches = cardEventSchema.options.map((branch) => branch.extend(extra))
  // `.map` erases the tuple-ness the discriminated union needs; the members stay
  // discriminable (each keeps its `eventType` literal), so assert the non-empty tuple.
  return z.discriminatedUnion(
    'eventType',
    branches as [(typeof branches)[number], ...(typeof branches)[number][]],
  )
}

const cardHistoryOutputSchema = pageSchemaOf(
  enrichedEventSchema({ onBehalfOfUserId: z.uuid().optional() }),
)
const createCardToolSchema = createCardInputSchema.extend({
  /** MCP-only attribution (mcp.md): resolved server-side, never client-trusted. */
  reporterEmail: z.email().optional(),
})
const updateCardToolSchema = updateCardInputSchema.extend(cardIdShape)
const moveCardToolSchema = moveCardInputSchema.extend(cardIdShape)
const commentToolSchema = addCommentInputSchema.extend(cardIdShape)

/** Terminal-action tool inputs: the core command schemas + the addressing `cardId`. */
const cancelCardToolSchema = cancelCardInputSchema.extend(cardIdShape)
const reopenCardToolSchema = reopenCardInputSchema.extend(cardIdShape)
const archiveCardToolSchema = archiveCardInputSchema.extend(cardIdShape)
const blockCardToolSchema = blockCardInputSchema.extend(cardIdShape)
const unblockCardToolSchema = unblockCardInputSchema.extend(cardIdShape)

/**
 * The board-wide activity feed: enriched events (mcp attribution PLUS the
 * user/slack `actorDisplayName` and the mcp `onBehalfOfDisplayName` companions)
 * and a top-level `users` map resolving every referenced id (mcp.md). Defined
 * once in core (`activityFeedSchemaOf`); the strict `activityUserSchema` keeps
 * the map values to {id, displayName, email}.
 */
const activityOutputSchema = activityFeedSchemaOf({
  event: enrichedEventSchema({
    onBehalfOfUserId: z.uuid().optional(),
    actorDisplayName: z.string().optional(),
    onBehalfOfDisplayName: z.string().optional(),
  }),
  user: activityUserSchema,
})

/**
 * whoami reports the caller's own identity, discriminated by `kind`. A `mcp`
 * service token returns its stored metadata (the hash is structurally omitted,
 * like the REST responses); an OAuth `agent` has no service-token row — it
 * returns the operator it acts on behalf of (`userId`; its id/role ARE the
 * user's) plus the client it authorized. `role`/`scope` are common to both; the
 * remaining fields are per-kind, so optional. A FLAT object (not a discriminated
 * union) because the MCP SDK only accepts an object schema as `outputSchema`.
 */
const serviceTokenMeta = serviceTokenSchema.omit({ tokenHash: true, role: true, scope: true })
const whoamiOutputSchema = z.object({
  kind: z.enum(['mcp', 'agent']),
  role: serviceTokenSchema.shape.role,
  scope: serviceTokenSchema.shape.scope,
  // Service-token identity (kind: 'mcp').
  ...z.object(serviceTokenMeta.shape).partial().shape,
  // Agent identity (kind: 'agent'): the operator it acts as + the client authorized.
  userId: z.uuid().optional(),
  client: z.strictObject({ id: z.string().min(1), name: z.string().min(1) }).optional(),
})

/** How many trailing audit events get_card returns (its "latest events" panel). */
const LATEST_EVENTS_TAKE = 20

/** Compact per-lane card projection — just enough to chain into get_card. */
const snapshotCardSchema = boardCardSchema.pick({
  id: true,
  title: true,
  priority: true,
  blocked: true,
  assigneeId: true,
  createdAt: true,
  updatedAt: true,
})

const snapshotOutputSchema = z.strictObject({
  lanes: z.array(
    z.strictObject({
      lane: laneSchema,
      cardCount: z.number().int().min(0),
      blockedCount: z.number().int().min(0),
      wipLimitExceeded: z.boolean(),
      oldestCardCreatedAt: isoDateTimeSchema.nullable(),
      cards: z.array(snapshotCardSchema),
    }),
  ),
})

/**
 * The lane-summary types derive from the output schema, so the projection in
 * `laneSummaryOf` is compile-checked against the declared JSON Schema surface
 * — `jsonResult` erases types, so nothing else would tie the two together.
 */
type LaneSummary = z.infer<typeof snapshotOutputSchema>['lanes'][number]
type SnapshotCard = z.infer<typeof snapshotCardSchema>

/**
 * Core's CardDetail envelope plus the tool's comment thread (soft-deleted
 * bodies arrive blanked from core) and latest-events panel.
 */
const cardDetailOutputSchema = cardDetailSchemaOf({
  card: cardSchema,
  tag: tagSchema,
  location: locationSchema,
  attachment: attachmentSchema,
}).extend({
  comments: z.array(redactedCommentSchema),
  latestEvents: z.array(cardEventSchema),
})

const staleCardsOutputSchema = z.strictObject({
  items: z.array(z.strictObject({ card: cardSchema, reasons: z.array(z.enum(STALE_REASONS)) })),
})

/**
 * Every tool result is returned both ways, per the MCP spec's guidance for
 * tools with output schemas: `structuredContent` (validated by the SDK
 * against the registered outputSchema before it leaves the server) plus the
 * same JSON in a text block for clients that only read content. Entities
 * carry ids + ISO timestamps so agents can chain calls.
 */
function jsonResult(value: object): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    // The cast bridges interface-typed results (e.g. core's Page<Card>) into
    // the SDK's index-signature type; runtime validity is enforced by the
    // SDK's outputSchema validation.
    structuredContent: value as Record<string, unknown>,
  }
}

/**
 * MCP behaviour hints (MCP spec `ToolAnnotations` — hints, not guarantees).
 * The SDK defaults them to the pessimistic `readOnly:false, destructive:true,
 * idempotent:false`, so every registered tool declares its own: reads are
 * read-only, non-destructive, idempotent, closed-world; writes flip
 * `readOnlyHint` off and set destructive/idempotent per the individual action
 * (audited tool-by-tool). `openWorldHint` is false everywhere — every tool
 * acts only on this board, never an external system.
 */
const READ_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

/**
 * Write default: a set-to-value mutation — not read-only, not destructive, and
 * idempotent (re-applying the same target value converges). Per-tool overrides
 * flip `destructiveHint` for lifecycle/deletes and `idempotentHint` for the
 * append actions (create/comment each add a new row).
 */
const WRITE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

/**
 * Scope is an always-on identity rule owned by core's policy engine; the
 * mount pre-checks it so read tokens never reach a service (belt and braces).
 */
function ensureWriteScope(actor: Actor): void {
  if (actor.scope === 'read') throw new PolicyDeniedError(READ_SCOPE_RULE)
}

/** Summary + compact cards per lane — counts and ids for chaining (mcp.md). */
function laneSummaryOf(lane: Lane, cards: BoardCard[], wipLimitExceeded: boolean): LaneSummary {
  return {
    lane,
    cardCount: cards.length,
    blockedCount: cards.filter((card) => card.blocked).length,
    wipLimitExceeded,
    oldestCardCreatedAt: cards.reduce<string | null>(
      (oldest, card) => (oldest === null || card.createdAt < oldest ? card.createdAt : oldest),
      null,
    ),
    cards: cards.map((card): SnapshotCard => ({
      id: card.id,
      title: card.title,
      priority: card.priority,
      blocked: card.blocked,
      assigneeId: card.assigneeId,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    })),
  }
}

export function buildMcpToolServer(deps: AppDeps, actor: Actor, log: FastifyBaseLogger): McpServer {
  const { queries, cards, comments, locations } = deps.services
  const server = new McpServer(
    { name: 'rivian-kanban', version: deps.config.version.version },
    { capabilities: { tools: {} } },
  )

  /**
   * Domain errors become problem-shaped tool errors; unknowns are sanitized.
   * Every invocation lands in the per-tool outcome counter
   * (deployment.md#observability) — denials and failures count as errors.
   */
  const guarded =
    <Args extends unknown[]>(tool: string, run: (...args: Args) => Promise<CallToolResult>) =>
    async (...args: Args): Promise<CallToolResult> => {
      try {
        const result = await run(...args)
        deps.metrics.mcpToolCalled(tool, 'success')
        return result
      } catch (error) {
        deps.metrics.mcpToolCalled(tool, 'error')
        const { status, body } = toProblem(error)
        if (status >= 500) log.error({ err: error }, 'mcp tool failed')
        return { isError: true, content: [{ type: 'text', text: JSON.stringify(body, null, 2) }] }
      }
    }

  /**
   * `guarded` for the write tools, with the always-on read/write identity
   * rule (mcp.md#authentication) declared once at the registration site.
   * Core's policy engine independently re-denies read-scope writes.
   */
  const mutating = <Args extends unknown[]>(
    tool: string,
    run: (...args: Args) => Promise<CallToolResult>,
  ): ((...args: Args) => Promise<CallToolResult>) =>
    guarded(tool, async (...args: Args) => {
      ensureWriteScope(actor)
      return run(...args)
    })

  /**
   * Registration helpers binding the tool name ONCE for both the SDK
   * registration and the outcome-counter wrapper — a rename or copy-paste can
   * never silently mislabel `mcp_tool_calls_total`. Typed as registerTool
   * itself, so call sites keep the SDK's schema↔handler generic checking.
   */
  const registerVia =
    (wrap: typeof guarded, defaultAnnotations: ToolAnnotations): McpServer['registerTool'] =>
    (name, config, handler) =>
      // The casts bridge the SDK's conditional ToolCallback type through the
      // uniform wrapper, which passes arguments and results through untouched;
      // the registerVia signature keeps every call site fully checked. Behaviour
      // hints default per registrar (read vs write); a call's own `annotations`
      // spread last, so per-tool overrides win.
      server.registerTool(
        name,
        { ...config, annotations: { ...defaultAnnotations, ...config.annotations } },
        wrap(
          name,
          handler as unknown as (...args: unknown[]) => Promise<CallToolResult>,
        ) as typeof handler,
      )
  const readTool = registerVia(guarded, READ_ANNOTATIONS)
  const writeTool = registerVia(mutating, WRITE_ANNOTATIONS)

  /**
   * Resolves `reporterEmail` to an ACTIVE user id, else the seeded system
   * user. Inactive accounts resolve exactly like unknown ones (same 404):
   * a deactivated user is not a valid attribution target (matching the Slack
   * assignee path), and the uniform outcome keeps the tool from doubling as
   * an account-existence oracle.
   */
  const resolveReporterId = async (reporterEmail: string | undefined): Promise<string> => {
    if (reporterEmail === undefined) return deps.systemUserId
    const account = await deps.uow.read((tx) => tx.userAccounts.findByEmail(reporterEmail))
    if (!account?.user.isActive) throw new NotFoundError('reporter')
    return account.user.id
  }

  readTool(
    'get_board_snapshot',
    {
      description:
        'The state of the shop: every lane in board order with its card count, blocked count, ' +
        'WIP-limit status, oldest-card age, and a compact list of its cards (ids chain into ' +
        'get_card / list_cards). Archived cards are excluded.',
      outputSchema: snapshotOutputSchema,
    },
    async () => {
      const snapshot = await queries.boardSnapshot()
      return jsonResult({
        lanes: snapshot.lanes.map(({ lane, cards: laneCards, wipLimitExceeded }) =>
          laneSummaryOf(lane, laneCards, wipLimitExceeded),
        ),
      })
    },
  )

  readTool(
    'list_cards',
    {
      description:
        'List cards newest-first with the same filters as the REST API: lane, assignee, ' +
        'reporter, priority, tag, blocked, waitingReason, overdueResume, q (title+description ' +
        'substring), includeArchived — cursor-paginated (default limit 50, max 200).',
      inputSchema: listCardsToolSchema,
      outputSchema: pageSchemaOf(cardSchema),
    },
    async (args: z.output<typeof listCardsToolSchema>) => {
      const { cursor, limit, ...filter } = args
      return jsonResult(
        await queries.listCards(filter, {
          limit,
          ...(cursor !== undefined ? { cursor } : {}),
        }),
      )
    },
  )

  readTool(
    'get_card',
    {
      description:
        'Full card detail: the card with tags, location, attachment metadata, the complete ' +
        'comment thread, and its latest audit events.',
      inputSchema: getCardToolSchema,
      outputSchema: cardDetailOutputSchema,
    },
    async (args: z.output<typeof getCardToolSchema>) =>
      // ONE core read composes detail + thread + trailing events: a single
      // snapshot and card lookup, and the three parts can never disagree
      // about a concurrently committed mutation.
      jsonResult(await queries.cardDetailWithThread(args.cardId, LATEST_EVENTS_TAKE)),
  )

  readTool(
    'get_card_history',
    {
      description:
        "A card's audit trail (who did what, from which surface), oldest-first, optionally " +
        'filtered by event type — cursor-paginated.',
      inputSchema: cardHistoryToolSchema,
      outputSchema: cardHistoryOutputSchema,
    },
    async (args: z.output<typeof cardHistoryToolSchema>) => {
      const { cardId, ...request } = args
      return jsonResult(await queries.cardHistory(cardId, request))
    },
  )

  readTool(
    'list_stale_cards',
    {
      description:
        'The follow-up feed: cards past their expected resume date, in review longer than ' +
        'reviewDays (default 7), or blocked longer than blockedDays (default 3), each with its ' +
        'staleness reasons.',
      inputSchema: staleCardsInputSchema,
      outputSchema: staleCardsOutputSchema,
    },
    async (args: z.output<typeof staleCardsInputSchema>) =>
      jsonResult({ items: await queries.staleCards(args) }),
  )

  readTool(
    'list_activity',
    {
      description:
        'The board-wide activity feed: card events across ALL cards since a timestamp, ' +
        'newest-first, cursor-paginated. Filters (all optional): sinceIso (ISO datetime; ' +
        'defaults to 24 hours ago), type (event type), cardId, actorKind (user/mcp/slack/' +
        'system). Requires the viewAllActivity permission to see the cross-user feed; ' +
        'without it a token is scoped to its own creator’s activity. Each item carries ' +
        'actorDisplayName / onBehalfOfDisplayName, and the top-level users map resolves every ' +
        'referenced user id ({id, displayName, email}).',
      inputSchema: activityFeedRequestSchema,
      outputSchema: activityOutputSchema,
    },
    async (args: z.output<typeof activityFeedRequestSchema>) =>
      jsonResult(await queries.eventsSince(actor, args)),
  )

  readTool(
    'list_lanes',
    {
      description:
        "The board's lanes in board order (id, key, label, position, wipLimit) — the workflow " +
        'columns cards move between.',
      outputSchema: z.strictObject({ lanes: z.array(laneSchema) }),
    },
    async () => jsonResult({ lanes: await queries.listLanes() }),
  )

  readTool(
    'list_locations',
    {
      description:
        "The board's locations (facilities/areas) as a flat parentId-linked tree (id, kind, " +
        'name, parentId). Resolve a location id here before setting a card.locationId in ' +
        'create_card / update_card — that field takes an id, not a name.',
      outputSchema: z.strictObject({ locations: z.array(locationSchema) }),
    },
    async () => jsonResult({ locations: await locations.list() }),
  )

  readTool(
    'list_tags',
    {
      description:
        'Every tag currently used on the board (id, name). Reuse an existing name when tagging ' +
        'cards (card tags are a full-replacement name array) instead of coining near-duplicates.',
      outputSchema: z.strictObject({ tags: z.array(tagSchema) }),
    },
    async () => jsonResult({ tags: await queries.listTags() }),
  )

  readTool(
    'list_blocked_cards',
    {
      description:
        'Every currently-blocked card (a thin blocked=true slice of list_cards), newest-first, ' +
        'cursor-paginated.',
      inputSchema: pageRequestSchema,
      outputSchema: pageSchemaOf(cardSchema),
    },
    async (args: z.output<typeof pageRequestSchema>) => {
      const { cursor, limit } = args
      return jsonResult(
        await queries.listCards(
          { blocked: true },
          { limit, ...(cursor !== undefined ? { cursor } : {}) },
        ),
      )
    },
  )

  readTool(
    'whoami',
    {
      description:
        "This service token's own identity: id, name, role, scope, createdAt, lastUsedAt. Any " +
        'token may inspect itself; the token hash is never returned.',
      outputSchema: whoamiOutputSchema,
    },
    async () => {
      // An OAuth agent has no service-token row: report the operator it acts as
      // (actor.id/role ARE the user's) plus the client it authorized.
      if (actor.kind === 'agent') {
        return jsonResult(
          whoamiOutputSchema.parse({
            kind: 'agent',
            userId: actor.id,
            role: actor.role,
            scope: actor.scope ?? 'read',
            client: actor.client ?? { id: 'unknown', name: 'unknown' },
          }),
        )
      }
      // The mcp actor carries its token id; tokens are few and admin-managed,
      // so the existing list() read resolves it without a new port method.
      const tokens = await deps.uow.read((tx) => tx.serviceTokens.list())
      const own = tokens.find((candidate) => candidate.id === actor.id)
      if (own === undefined) throw new NotFoundError('service token')
      // The stripping output schema drops tokenHash structurally (like the REST
      // service-token responses) — the hash can never leave the server.
      return jsonResult(whoamiOutputSchema.parse({ kind: 'mcp', ...own }))
    },
  )

  writeTool(
    'create_card',
    {
      description:
        'Create a card in the intake lane (origin mcp). Optional reporterEmail attributes it ' +
        'to that user; otherwise the automation (system) user is the reporter. Requires a ' +
        'read_write token.',
      inputSchema: createCardToolSchema,
      outputSchema: cardSchema,
      // Each call appends a new card — not idempotent.
      annotations: { idempotentHint: false },
    },
    async (args: z.output<typeof createCardToolSchema>) => {
      const { reporterEmail, ...input } = args
      const reporterId = await resolveReporterId(reporterEmail)
      return jsonResult(await cards.create(actor, input, { reporterId }))
    },
  )

  writeTool(
    'update_card',
    {
      description:
        'Edit card fields (tags are full-replacement). Requires expectedVersion (optimistic ' +
        'lock); a stale version returns a conflict carrying the current card. Requires a ' +
        'read_write token.',
      inputSchema: updateCardToolSchema,
      outputSchema: cardSchema,
    },
    async (args) => {
      const { cardId, ...input } = args
      return jsonResult(await cards.update(actor, cardId, input))
    },
  )

  writeTool(
    'move_card',
    {
      description:
        "Move a card to another lane (or reorder within one) under the board's configured " +
        'permission policy. The position comes from the prevCardId/nextCardId neighbors — ' +
        'take their ids from get_board_snapshot (omitting both targets the top of the lane ' +
        'and conflicts when that spot is taken). Entering waiting_parts_vendor requires ' +
        'waitingReason and expectedResumeAt. Requires expectedVersion and a read_write token.',
      inputSchema: moveCardToolSchema,
      outputSchema: cardSchema,
    },
    async (args) => {
      const { cardId, ...input } = args
      return jsonResult(await cards.move(actor, cardId, input))
    },
  )

  writeTool(
    'comment_on_card',
    {
      description:
        'Add a comment to a card (authored as the automation user, audited with the token ' +
        'identity); parentCommentId threads a reply. Requires a read_write token.',
      inputSchema: commentToolSchema,
      outputSchema: commentSchema,
      // Each call appends a new comment — not idempotent.
      annotations: { idempotentHint: false },
    },
    async (args) => {
      const { cardId, ...input } = args
      return jsonResult(await comments.add(actor, cardId, input, { authorId: deps.systemUserId }))
    },
  )

  writeTool(
    'cancel_card',
    {
      description:
        'Cancel a non-terminal card: moves it to the bottom of done with the given cancel ' +
        'resolution (no requester notification). Requires expectedVersion and a read_write token.',
      inputSchema: cancelCardToolSchema,
      outputSchema: cardSchema,
      // Lifecycle terminal action — flag it destructive (reversible via reopen).
      annotations: { destructiveHint: true },
    },
    async (args) => {
      const { cardId, ...input } = args
      return jsonResult(await cards.cancel(actor, cardId, input))
    },
  )

  writeTool(
    'reopen_card',
    {
      description:
        'Reopen a card in done (including cancelled/archived): clears the resolution and ' +
        'archived flag and places it at the bottom of ready. Requires expectedVersion and a ' +
        'read_write token.',
      inputSchema: reopenCardToolSchema,
      outputSchema: cardSchema,
    },
    async (args) => {
      const { cardId, ...input } = args
      return jsonResult(await cards.reopen(actor, cardId, input))
    },
  )

  writeTool(
    'archive_card',
    {
      description:
        'Manually archive a Done card (completed or cancelled): sets archivedAt so it leaves ' +
        'the board. Reopen reverses it. Requires expectedVersion and a read_write token.',
      inputSchema: archiveCardToolSchema,
      outputSchema: cardSchema,
      // Lifecycle terminal action — flag it destructive (reversible via reopen).
      annotations: { destructiveHint: true },
    },
    async (args) => {
      const { cardId, ...input } = args
      return jsonResult(await cards.archive(actor, cardId, input))
    },
  )

  writeTool(
    'block_card',
    {
      description:
        'Raise the blocked flag on a card (any lane; the card stays put) with a reason. ' +
        'Requires expectedVersion and a read_write token.',
      inputSchema: blockCardToolSchema,
      outputSchema: cardSchema,
    },
    async (args) => {
      const { cardId, ...input } = args
      return jsonResult(await cards.block(actor, cardId, input))
    },
  )

  writeTool(
    'unblock_card',
    {
      description:
        'Clear the blocked flag on a card. Requires expectedVersion and a read_write token.',
      inputSchema: unblockCardToolSchema,
      outputSchema: cardSchema,
    },
    async (args) => {
      const { cardId, ...input } = args
      return jsonResult(await cards.unblock(actor, cardId, input))
    },
  )

  return server
}

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  addCommentInputSchema,
  attachmentSchema,
  boardCardSchema,
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
  STALE_REASONS,
  staleCardsInputSchema,
  tagSchema,
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
 * The 9 MCP tools (docs/architecture/mcp.md#tools). Handlers call the same
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

const cardIdShape = { cardId: z.uuid() }

const listCardsToolSchema = listCardsFilterSchema.extend(pageRequestSchema.shape)
const getCardToolSchema = z.strictObject(cardIdShape)
const cardHistoryToolSchema = cardHistoryRequestSchema.extend(cardIdShape)
const createCardToolSchema = createCardInputSchema.extend({
  /** MCP-only attribution (mcp.md): resolved server-side, never client-trusted. */
  reporterEmail: z.email().optional(),
})
const updateCardToolSchema = updateCardInputSchema.extend(cardIdShape)
const moveCardToolSchema = moveCardInputSchema.extend(cardIdShape)
const commentToolSchema = addCommentInputSchema.extend(cardIdShape)

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
  const { queries, cards, comments } = deps.services
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
    (wrap: typeof guarded): McpServer['registerTool'] =>
    (name, config, handler) =>
      // The casts bridge the SDK's conditional ToolCallback type through the
      // uniform wrapper, which passes arguments and results through untouched;
      // the registerVia signature keeps every call site fully checked.
      server.registerTool(
        name,
        config,
        wrap(
          name,
          handler as unknown as (...args: unknown[]) => Promise<CallToolResult>,
        ) as typeof handler,
      )
  const readTool = registerVia(guarded)
  const writeTool = registerVia(mutating)

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
      outputSchema: pageSchemaOf(cardEventSchema),
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

  writeTool(
    'create_card',
    {
      description:
        'Create a card in the intake lane (origin mcp). Optional reporterEmail attributes it ' +
        'to that user; otherwise the automation (system) user is the reporter. Requires a ' +
        'read_write token.',
      inputSchema: createCardToolSchema,
      outputSchema: cardSchema,
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
    },
    async (args) => {
      const { cardId, ...input } = args
      return jsonResult(await comments.add(actor, cardId, input, { authorId: deps.systemUserId }))
    },
  )

  return server
}

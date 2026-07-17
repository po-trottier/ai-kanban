import {
  ADMIN_ONLY_RULE,
  NotFoundError,
  PolicyDeniedError,
  type Actor,
  type EventBus,
  type Lane,
  type UnitOfWork,
} from '@rivian-kanban/core'
import { z } from 'zod'

/**
 * Lane admin edits (docs/architecture/rest-api.md#admin: PATCH /lanes/:id —
 * label and WIP limit only). Lane keys and positions are structural — the
 * 7-lane workflow is seeded, never reshaped at runtime. Admin-only is an
 * always-on rule (security.md#authorization), and every change publishes the
 * board-scoped `lane.updated` hint (ADR-008).
 */

export const updateLaneInputSchema = z
  .strictObject({
    label: z.string().trim().min(1).max(50).optional(),
    /** null clears the WIP limit. */
    wipLimit: z.number().int().positive().nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'at least one of label or wipLimit is required',
  })

function requireAdmin(actor: Actor): void {
  if (actor.role !== 'admin') throw new PolicyDeniedError(ADMIN_ONLY_RULE)
}

export interface LaneAdminServiceDeps {
  uow: UnitOfWork
  eventBus: EventBus
  boardId: string
}

export class LaneAdminService {
  private readonly deps: LaneAdminServiceDeps

  constructor(deps: LaneAdminServiceDeps) {
    this.deps = deps
  }

  /** Edits label and/or WIP limit; unknown lane 404, empty patch 400 (Zod). */
  async update(actor: Actor, laneId: string, rawInput: unknown): Promise<Lane> {
    requireAdmin(actor)
    const input = updateLaneInputSchema.parse(rawInput)
    const updated = await this.deps.uow.run(async (tx) => {
      // Single board, 7 lanes — the board list doubles as the id lookup.
      const lane = (await tx.lanes.listByBoard(this.deps.boardId)).find(
        (candidate) => candidate.id === laneId,
      )
      if (lane === undefined) throw new NotFoundError('lane')
      const next: Lane = {
        ...lane,
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.wipLimit !== undefined ? { wipLimit: input.wipLimit } : {}),
      }
      await tx.lanes.update(next)
      return next
    })
    this.deps.eventBus.publish({ type: 'lane.updated' })
    return updated
  }
}

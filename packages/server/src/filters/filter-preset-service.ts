import {
  createFilterPresetInputSchema,
  NotFoundError,
  updateFilterPresetInputSchema,
  type Actor,
  type Clock,
  type FilterPreset,
  type IdGenerator,
  type UnitOfWork,
} from '@rivian-kanban/core'

/**
 * Per-user saved board filters (docs/architecture/board-filters.md). Managing
 * your OWN presets is an identity right, not an RBAC-gated surface — like
 * editing your own comment — so there is no `manage*` permission check here;
 * every method is scoped to `actor.id`. A preset owned by another user is
 * indistinguishable from a missing one (both 404), so the server never
 * confirms another user's preset exists.
 *
 * Custom (CRUD) presets only; the two built-ins (`BUILTIN_FILTER_PRESETS`) are
 * core constants the frontend renders, never rows.
 */
export interface FilterPresetServiceDeps {
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
}

export class FilterPresetService {
  private readonly deps: FilterPresetServiceDeps

  constructor(deps: FilterPresetServiceDeps) {
    this.deps = deps
  }

  /** The caller's presets, newest-first. */
  async list(actor: Actor): Promise<FilterPreset[]> {
    return this.deps.uow.read((tx) => tx.filterPresets.listByOwner(actor.id))
  }

  /** Creates a preset owned by the caller (ownerId from the session, never the body). */
  async create(actor: Actor, rawInput: unknown): Promise<FilterPreset> {
    const input = createFilterPresetInputSchema.parse(rawInput)
    const nowIso = this.deps.clock.now().toISOString()
    const preset: FilterPreset = {
      id: this.deps.ids.newId(),
      ownerId: actor.id,
      name: input.name,
      filter: input.filter,
      createdAt: nowIso,
      updatedAt: nowIso,
    }
    await this.deps.uow.run((tx) => tx.filterPresets.insert(preset))
    return preset
  }

  /** Renames and/or replaces the filter — only if owned by the caller (else 404). */
  async update(actor: Actor, presetId: string, rawInput: unknown): Promise<FilterPreset> {
    const input = updateFilterPresetInputSchema.parse(rawInput)
    return this.deps.uow.run(async (tx) => {
      const existing = await tx.filterPresets.findByIdForOwner(presetId, actor.id)
      if (existing === null) throw new NotFoundError('filter preset')
      const updated: FilterPreset = {
        ...existing,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.filter !== undefined ? { filter: input.filter } : {}),
        updatedAt: this.deps.clock.now().toISOString(),
      }
      await tx.filterPresets.update(updated)
      return updated
    })
  }

  /** Deletes the caller's preset; a not-owned or unknown id is 404. */
  async delete(actor: Actor, presetId: string): Promise<void> {
    await this.deps.uow.run((tx) => tx.filterPresets.delete(presetId, actor.id))
  }
}

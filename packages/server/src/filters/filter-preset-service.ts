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
 * Saved board filters (docs/architecture/board-filters.md). Managing your OWN
 * presets is an identity right, not an RBAC-gated surface — like editing your
 * own comment — so there is no `manage*` permission check here. Reads return the
 * caller's own presets plus every team-shared one (`listVisibleTo`); every WRITE
 * is scoped to `actor.id`, so a preset owned by another user is indistinguishable
 * from a missing one (both 404) — a shared preset is applyable by all but
 * editable only by its owner.
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

  /** Presets visible to the caller — their own plus shared ones, newest-first. */
  async list(actor: Actor): Promise<FilterPreset[]> {
    return this.deps.uow.read((tx) => tx.filterPresets.listVisibleTo(actor.id))
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
      shared: input.shared,
      createdAt: nowIso,
      updatedAt: nowIso,
    }
    await this.deps.uow.run((tx) => tx.filterPresets.insert(preset))
    return preset
  }

  /** Renames, replaces the filter, and/or (un)shares — only if owned by the caller (else 404). */
  async update(actor: Actor, presetId: string, rawInput: unknown): Promise<FilterPreset> {
    const input = updateFilterPresetInputSchema.parse(rawInput)
    return this.deps.uow.run(async (tx) => {
      const existing = await tx.filterPresets.findByIdForOwner(presetId, actor.id)
      if (existing === null) throw new NotFoundError('filter preset')
      const updated: FilterPreset = {
        ...existing,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.filter !== undefined ? { filter: input.filter } : {}),
        ...(input.shared !== undefined ? { shared: input.shared } : {}),
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

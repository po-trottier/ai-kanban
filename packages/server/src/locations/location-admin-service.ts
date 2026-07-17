import {
  ConflictError,
  createLocationInputSchema,
  ensureAdmin,
  NotFoundError,
  updateLocationInputSchema,
  type Actor,
  type EventBus,
  type IdGenerator,
  type Location,
  type TransactionContext,
  type UnitOfWork,
} from '@rivian-kanban/core'
import { RequestValidationError } from '../errors.ts'

/**
 * Locations read + admin CRUD (docs/architecture/rest-api.md#history--metadata).
 * The tree is strict: buildings have no parent, floors sit under buildings,
 * rooms under floors — an always-on data-integrity rule, not policy.
 */

/** kind → required parent kind (null = must be a root). */
const REQUIRED_PARENT_KIND = {
  building: null,
  floor: 'building',
  room: 'floor',
} as const

// Location rows carry no timestamps, so unlike its admin siblings this
// service takes no Clock.
export interface LocationAdminServiceDeps {
  uow: UnitOfWork
  ids: IdGenerator
  eventBus: EventBus
}

export class LocationAdminService {
  private readonly deps: LocationAdminServiceDeps

  constructor(deps: LocationAdminServiceDeps) {
    this.deps = deps
  }

  /** The whole tree as a flat parentId-linked list (any authenticated user). */
  async list(): Promise<Location[]> {
    return this.deps.uow.read((tx) => tx.locations.list())
  }

  /**
   * Policy checks: admin only (always-on). Validates the parent exists and
   * matches the kind hierarchy (400 via ZodError; missing parent 404).
   */
  async create(actor: Actor, rawInput: unknown): Promise<Location> {
    ensureAdmin(actor)
    const input = createLocationInputSchema.parse(rawInput)
    const location: Location = {
      id: this.deps.ids.newId(),
      parentId: input.parentId,
      kind: input.kind,
      name: input.name,
    }
    const created = await this.deps.uow.run(async (tx) => {
      const requiredParent = REQUIRED_PARENT_KIND[input.kind]
      if (requiredParent === null) {
        if (input.parentId !== null) {
          throw new RequestValidationError('parentId', 'a building cannot have a parent')
        }
      } else {
        if (input.parentId === null) {
          throw new RequestValidationError(
            'parentId',
            `a ${input.kind} requires a ${requiredParent} parent`,
          )
        }
        const parent = await tx.locations.findById(input.parentId)
        if (parent === null) throw new NotFoundError('parent location')
        if (parent.kind !== requiredParent) {
          throw new RequestValidationError(
            'parentId',
            `a ${input.kind} must sit under a ${requiredParent}`,
          )
        }
      }
      await ensureUniqueSiblingName(tx, input.parentId, input.name, null)
      await tx.locations.insert(location)
      return location
    })
    this.deps.eventBus.publish({ type: 'location.updated' })
    return created
  }

  /** Rename only — reparenting would silently move every child. Admin only. */
  async update(actor: Actor, locationId: string, rawInput: unknown): Promise<Location> {
    ensureAdmin(actor)
    const input = updateLocationInputSchema.parse(rawInput)
    const updated = await this.deps.uow.run(async (tx) => {
      const found = await tx.locations.findById(locationId)
      if (found === null) throw new NotFoundError('location')
      await ensureUniqueSiblingName(tx, found.parentId, input.name, found.id)
      const next: Location = { ...found, name: input.name }
      await tx.locations.update(next)
      return next
    })
    this.deps.eventBus.publish({ type: 'location.updated' })
    return updated
  }

  /**
   * Recursive hard delete: the location and its whole subtree go together, and
   * cards that referenced any removed node keep their row with `location_id`
   * cleared (location is optional). Deleting a building/floor with children
   * therefore succeeds — no 409; a missing id is the only failure (404). Admin
   * only.
   */
  async delete(actor: Actor, locationId: string): Promise<void> {
    ensureAdmin(actor)
    await this.deps.uow.run((tx) => tx.locations.delete(locationId))
    this.deps.eventBus.publish({ type: 'location.updated' })
  }
}

/**
 * Rejects a name that collides (case-insensitively) with an existing sibling —
 * a location sharing the same `parentId`. Two different buildings may each hold
 * a "Floor 1", but one building may not hold two. The check reads the flat tree
 * and filters in memory: at facilities scale (buildings/floors/rooms) the list
 * is tiny, so a service-level guard is sufficient and no DB UNIQUE index is
 * added — the tree table has no such constraint. `selfId` is the row being
 * renamed, excluded so renaming a location to its own current name is a no-op.
 */
async function ensureUniqueSiblingName(
  tx: TransactionContext,
  parentId: string | null,
  name: string,
  selfId: string | null,
): Promise<void> {
  const normalized = name.trim().toLowerCase()
  const all = await tx.locations.list()
  const clash = all.some(
    (location) =>
      location.id !== selfId &&
      location.parentId === parentId &&
      location.name.trim().toLowerCase() === normalized,
  )
  if (clash) {
    throw new ConflictError(`a location named “${name}” already exists here`)
  }
}

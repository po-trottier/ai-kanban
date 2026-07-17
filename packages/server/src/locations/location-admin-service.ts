import {
  createLocationInputSchema,
  ensureAdmin,
  NotFoundError,
  updateLocationInputSchema,
  type Actor,
  type EventBus,
  type IdGenerator,
  type Location,
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
      const next: Location = { ...found, name: input.name }
      await tx.locations.update(next)
      return next
    })
    this.deps.eventBus.publish({ type: 'location.updated' })
    return updated
  }

  /**
   * Hard delete; still-referenced locations (children, cards) are a 409
   * ConflictError from the repository (FK backstop). Admin only.
   */
  async delete(actor: Actor, locationId: string): Promise<void> {
    ensureAdmin(actor)
    await this.deps.uow.run((tx) => tx.locations.delete(locationId))
    this.deps.eventBus.publish({ type: 'location.updated' })
  }
}

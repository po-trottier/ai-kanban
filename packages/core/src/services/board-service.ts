import { type Actor, type Board } from '../domain/entities.ts'
import {
  boardInputSchema,
  DEFAULT_LANES,
  groupInputSchema,
  type Group,
  boardPreferenceSchema,
  type BoardCatalog,
  type BoardDefault,
  type BoardInput,
} from '../domain/boards.ts'

import { ConflictError, NotFoundError, PolicyDeniedError } from '../domain/errors.ts'
import { DEFAULT_POLICY_DOCUMENT } from '../domain/policy.ts'
import { ensurePermission, hasPermission } from '../policy/policy-engine.ts'
import { type TransactionContext, type UnitOfWork } from '../ports/repositories.ts'
import { type Clock, type EventBus, type IdGenerator } from '../ports/runtime.ts'
import { canAccessBoard, globalPolicy, requireBoardAccess } from './board-access.ts'
import { requireFound } from './internal.ts'
import { type SseHint } from '../domain/sse.ts'

export class BoardService {
  private readonly deps: { uow: UnitOfWork; clock: Clock; ids: IdGenerator; eventBus: EventBus }
  constructor(deps: { uow: UnitOfWork; clock: Clock; ids: IdGenerator; eventBus: EventBus }) {
    this.deps = deps
  }

  async list(actor: Actor): Promise<BoardCatalog> {
    return this.deps.uow.read(async (tx) => {
      const items: Board[] = []
      const canManage = hasPermission(actor, 'managePolicy', await globalPolicy(tx))
      for (const board of await tx.boards.list()) {
        if (await canAccessBoard(tx, actor, board)) {
          // Discovery needs a name and ID, not other people's access assignments.
          items.push(
            canManage
              ? board
              : { ...board, allowedRoleKeys: [], allowedUserIds: [], allowedGroupIds: [] },
          )
        }
      }
      const defaults = await tx.boards.listDefaults(actor.kind === 'user' ? actor.id : null)
      const visible = new Set(items.map((board) => board.id))
      const allowedDefaults = defaults.filter((row) => visible.has(row.boardId))
      const preferredBoardId = allowedDefaults.find((row) => row.scope === 'user')?.boardId ?? null
      const groupBoards = new Set<string>()
      if (actor.kind === 'user') {
        for (const row of allowedDefaults.filter((row) => row.scope === 'group')) {
          if ((await tx.groups.findById(row.subject))?.userIds.includes(actor.id))
            groupBoards.add(row.boardId)
        }
      }
      const candidates: [BoardCatalog['defaultSource'], string | null | undefined][] = [
        ['personal', preferredBoardId],
        ['group', groupBoards.size === 1 ? [...groupBoards][0] : null],
        [
          'role',
          allowedDefaults.find((row) => row.scope === 'role' && row.subject === actor.role)
            ?.boardId,
        ],
        ['application', allowedDefaults.find((row) => row.scope === 'application')?.boardId],
      ]
      const chosen = candidates.find(([, id]) => id != null)
      return {
        items,
        canManage,
        preferredBoardId,
        defaultBoardId: chosen?.[1] ?? items[0]?.id ?? null,
        defaultSource: chosen?.[0] ?? 'fallback',
        defaultAssignments: canManage
          ? defaults.filter((row) => row.scope !== 'user' && visible.has(row.boardId))
          : [],
      }
    })
  }

  async requireAccess(actor: Actor, boardId: string): Promise<Board> {
    return this.deps.uow.read((tx) => requireBoardAccess(tx, actor, boardId))
  }

  async acceptsHint(actor: Actor, boardId: string, hint: SseHint): Promise<boolean> {
    return this.deps.uow.read(async (tx) => {
      await requireBoardAccess(tx, actor, boardId)
      if (!('cardId' in hint)) return true
      const card = await tx.cards.findById(hint.cardId)
      return card?.boardId === boardId
    })
  }

  async create(actor: Actor, raw: unknown): Promise<Board> {
    const { defaultAssignments, ...input } = boardInputSchema.parse(raw)
    const board = await this.deps.uow.run(async (tx) => {
      await this.lockAdministration(tx, actor)
      await this.validateAccess(tx, input)
      const created: Board = {
        ...input,
        id: this.deps.ids.newId(),
        createdAt: this.deps.clock.now().toISOString(),
        isDefault: false,
        archivedAt: null,
      }
      await tx.boards.insert(created)
      await this.saveDefaults(tx, created.id, defaultAssignments)
      for (const [position, lane] of DEFAULT_LANES.entries()) {
        await tx.lanes.insert({ ...lane, id: this.deps.ids.newId(), boardId: created.id, position })
      }
      await tx.policies.insert({
        id: this.deps.ids.newId(),
        boardId: created.id,
        config: { ...DEFAULT_POLICY_DOCUMENT, roles: (await globalPolicy(tx)).roles },
        createdAt: created.createdAt,
        createdBy: actor.id,
      })
      return created
    })
    this.deps.eventBus.publish({ type: 'board.updated' })
    return board
  }

  async update(actor: Actor, boardId: string, raw: unknown): Promise<Board> {
    const { defaultAssignments, ...input } = boardInputSchema.parse(raw)
    const board = await this.deps.uow.run(async (tx) => {
      await this.lockAdministration(tx, actor)
      const current = await requireBoardAccess(tx, actor, boardId)
      await this.validateAccess(tx, input)
      const updated = { ...current, ...input }
      await tx.boards.update(updated)
      await this.saveDefaults(tx, boardId, defaultAssignments)
      return updated
    })
    this.deps.eventBus.publish({ type: 'board.updated' })
    return board
  }

  async remove(actor: Actor, boardId: string): Promise<void> {
    await this.deps.uow.run(async (tx) => {
      await this.lockAdministration(tx, actor)
      const board = await requireBoardAccess(tx, actor, boardId)
      if ((await tx.boards.list()).length <= 1)
        throw new ConflictError('the last board cannot be deleted')
      await tx.boards.update({ ...board, archivedAt: this.deps.clock.now().toISOString() })
    })
    this.deps.eventBus.publish({ type: 'board.updated' })
  }

  private async lockAdministration(tx: TransactionContext, actor: Actor): Promise<void> {
    const authority = requireFound(await tx.boards.getDefault(), 'default board')
    const policy = requireFound(await tx.policies.getActiveForUpdate(authority.id), 'policy')
    ensurePermission(actor, 'managePolicy', policy.config)
  }

  async setPreference(actor: Actor, raw: unknown): Promise<BoardCatalog> {
    const { boardId } = boardPreferenceSchema.parse(raw)
    if (actor.kind !== 'user') throw new PolicyDeniedError('personal-board-preference')
    await this.deps.uow.run(async (tx) => {
      // Share the administration lock so access cannot change between validation and save.
      const authority = requireFound(await tx.boards.getDefault(), 'default board')
      await tx.policies.getActiveForUpdate(authority.id)
      if (boardId !== null) await requireBoardAccess(tx, actor, boardId)
      await tx.boards.setDefault('user', actor.id, boardId)
    })
    this.deps.eventBus.publish({ type: 'board.updated' })
    return this.list(actor)
  }

  private async saveDefaults(
    tx: TransactionContext,
    boardId: string,
    input: BoardInput['defaultAssignments'],
  ): Promise<void> {
    if (input === undefined) return
    await this.validateAccess(tx, {
      allowedRoleKeys: input.roleKeys,
      allowedGroupIds: input.groupIds,
      allowedUserIds: [],
    })
    const desired: BoardDefault[] = [
      ...(input.application ? [{ scope: 'application' as const, subject: 'all', boardId }] : []),
      ...[...new Set(input.roleKeys)].map((subject) => ({
        scope: 'role' as const,
        subject,
        boardId,
      })),
      ...[...new Set(input.groupIds)].map((subject) => ({
        scope: 'group' as const,
        subject,
        boardId,
      })),
    ]
    for (const row of await tx.boards.listDefaults(null)) {
      if (
        row.boardId === boardId &&
        !desired.some((next) => next.scope === row.scope && next.subject === row.subject)
      ) {
        await tx.boards.setDefault(row.scope, row.subject, null)
      }
    }
    for (const row of desired) await tx.boards.setDefault(row.scope, row.subject, boardId)
  }

  private async validateAccess(
    tx: TransactionContext,
    input: Pick<Board, 'allowedRoleKeys' | 'allowedUserIds' | 'allowedGroupIds'>,
  ): Promise<void> {
    const roles = new Set((await globalPolicy(tx)).roles.map((role) => role.key))
    if (input.allowedRoleKeys.some((key) => !roles.has(key))) throw new NotFoundError('role')
    for (const id of new Set(input.allowedUserIds)) {
      requireFound(await tx.users.findById(id), 'user')
    }
    for (const id of new Set(input.allowedGroupIds))
      requireFound(await tx.groups.findById(id), 'group')
  }

  async listGroups(actor: Actor): Promise<Group[]> {
    return this.deps.uow.read(async (tx) => {
      ensurePermission(actor, 'managePolicy', await globalPolicy(tx))
      return tx.groups.list()
    })
  }

  async saveGroup(actor: Actor, groupId: string | null, raw: unknown): Promise<Group> {
    const input = groupInputSchema.parse(raw)
    const group = await this.deps.uow.run(async (tx) => {
      await this.lockAdministration(tx, actor)
      const existing =
        groupId === null ? null : requireFound(await tx.groups.findById(groupId), 'group')
      if (
        (await tx.groups.list()).some(
          (item) => item.id !== groupId && item.name.toLowerCase() === input.name.toLowerCase(),
        )
      )
        throw new ConflictError('a group with that name already exists')
      for (const id of new Set(input.userIds)) requireFound(await tx.users.findById(id), 'user')
      const saved: Group = {
        ...input,
        userIds: [...new Set(input.userIds)],
        id: existing?.id ?? this.deps.ids.newId(),
        createdAt: existing?.createdAt ?? this.deps.clock.now().toISOString(),
      }
      if (existing === null) await tx.groups.insert(saved)
      else await tx.groups.update(saved)
      return saved
    })
    this.deps.eventBus.publish({ type: 'board.updated' })
    return group
  }

  async removeGroup(actor: Actor, groupId: string): Promise<void> {
    await this.deps.uow.run(async (tx) => {
      await this.lockAdministration(tx, actor)
      requireFound(await tx.groups.findById(groupId), 'group')
      if ((await tx.boards.list()).some((board) => board.allowedGroupIds.includes(groupId)))
        throw new ConflictError('group-in-use: remove this group from board access settings first')
      await tx.groups.remove(groupId)
      await tx.boards.setDefault('group', groupId, null)
    })
    this.deps.eventBus.publish({ type: 'board.updated' })
  }
}

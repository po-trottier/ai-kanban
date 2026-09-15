import { z } from 'zod'
import { type FastifyRequest } from 'fastify'
import { type AppDeps } from '../types.ts'

/** Immutable request selection. Resource services authorize the card's persisted board. */
export function selectedBoardId(deps: AppDeps, request: FastifyRequest): string {
  const header = request.headers['x-board-id']
  const query = new URL(request.raw.url ?? '/', 'http://localhost').searchParams.get('boardId')
  return z.uuid().parse(header ?? query ?? deps.defaultBoardId)
}

export function boardServices(deps: AppDeps, request: FastifyRequest) {
  return deps.forBoard(selectedBoardId(deps, request))
}

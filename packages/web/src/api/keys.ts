import { type BoardFilter } from '@rivian-kanban/core'

/** Query-key catalog — the one vocabulary shared by hooks and SSE invalidation. */
export const queryKeys = {
  me: ['me'] as const,
  setup: ['setup'] as const,
  /**
   * The board root prefix — every board variant (unfiltered + each filtered
   * query) hangs under it, so a single `invalidateQueries({ queryKey: board })`
   * refetches whichever board is mounted (TanStack prefix match). SSE + move
   * invalidations use this; the actual subscription uses `boardQuery(filter)`.
   */
  board: ['board'] as const,
  /** One board query per filter (`{}` = unfiltered). Used for the query + its
   *  exact-key optimistic reads/writes; still prefix-matched by `board`. */
  boardQuery: (filter: BoardFilter) => ['board', filter] as const,
  policy: ['policy'] as const,
  users: ['users'] as const,
  /** Async user-picker search: one entry per query text (short-lived cache). */
  userSearch: (q: string) => ['users', 'search', q] as const,
  /** Resolve an explicit set of ids to picker shapes (selected-value labels). */
  userResolve: (ids: readonly string[]) => ['users', 'resolve', [...ids].sort()] as const,
  locations: ['locations'] as const,
  tags: ['tags'] as const,
  filterPresets: ['filter-presets'] as const,
  serviceTokens: ['service-tokens'] as const,
  card: (cardId: string) => ['card', cardId] as const,
  comments: (cardId: string) => ['comments', cardId] as const,
  events: (cardId: string) => ['events', cardId] as const,
}

/** Query-key catalog — the one vocabulary shared by hooks and SSE invalidation. */
export const queryKeys = {
  me: ['me'] as const,
  setup: ['setup'] as const,
  board: ['board'] as const,
  policy: ['policy'] as const,
  users: ['users'] as const,
  locations: ['locations'] as const,
  tags: ['tags'] as const,
  serviceTokens: ['service-tokens'] as const,
  card: (cardId: string) => ['card', cardId] as const,
  cardList: (filters: { q: string; includeArchived: boolean }) => ['cards', filters] as const,
  comments: (cardId: string) => ['comments', cardId] as const,
  events: (cardId: string) => ['events', cardId] as const,
}

import { boardFilterSchema, EMPTY_BOARD_FILTER, type BoardFilter } from '@rivian-kanban/core'

/**
 * The live board filter ⇄ the URL query string, so a filtered board is shareable
 * by just copying the link (docs/architecture/board-filters.md#frontend). Each
 * facet is its own query param, arrays as REPEATED params
 * (`?priority=P0&priority=P1`) so a free-text or tag value carrying commas/spaces
 * round-trips without a delimiter to escape. Empty facets are omitted, so an
 * unfiltered board stays a clean `/`.
 *
 * Decoding runs the assembled shape back through `boardFilterSchema` (the single
 * schema) — the URL is a trust boundary, so a hand-edited or stale link that no
 * longer parses (an unknown priority, an over-long array) falls back to the
 * EMPTY filter rather than throwing or fetching a malformed query.
 */
const PARAM = {
  q: 'q',
  scope: 'scope',
  overdue: 'overdue',
  priorities: 'priority',
  assigneeIds: 'assignee',
  reporterIds: 'reporter',
  tags: 'tag',
  locationIds: 'location',
} as const

export function filterToSearchParams(filter: BoardFilter): URLSearchParams {
  const params = new URLSearchParams()
  if (filter.q !== '') params.set(PARAM.q, filter.q)
  if (filter.scope !== 'active') params.set(PARAM.scope, filter.scope)
  if (filter.overdue) params.set(PARAM.overdue, '1')
  for (const value of filter.priorities) params.append(PARAM.priorities, value)
  for (const value of filter.assigneeIds) params.append(PARAM.assigneeIds, value)
  for (const value of filter.reporterIds) params.append(PARAM.reporterIds, value)
  for (const value of filter.tags) params.append(PARAM.tags, value)
  for (const value of filter.locationIds) params.append(PARAM.locationIds, value)
  return params
}

export function filterFromSearchParams(params: URLSearchParams): BoardFilter {
  const q = params.get(PARAM.q)
  const scope = params.get(PARAM.scope)
  // Omit absent scalars so the schema applies their defaults; a `null` scope
  // would fail the enum. Arrays default to `[]` when the param is absent.
  const candidate = {
    ...(q === null ? {} : { q }),
    ...(scope === null ? {} : { scope }),
    overdue: params.get(PARAM.overdue) === '1',
    priorities: params.getAll(PARAM.priorities),
    assigneeIds: params.getAll(PARAM.assigneeIds),
    reporterIds: params.getAll(PARAM.reporterIds),
    tags: params.getAll(PARAM.tags),
    locationIds: params.getAll(PARAM.locationIds),
  }
  const parsed = boardFilterSchema.safeParse(candidate)
  return parsed.success ? parsed.data : EMPTY_BOARD_FILTER
}

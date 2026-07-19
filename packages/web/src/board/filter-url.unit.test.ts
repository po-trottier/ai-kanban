import { EMPTY_BOARD_FILTER, type BoardFilter } from '@rivian-kanban/core'
import { describe, expect, it } from 'vitest'
import { uid } from '../test/fixtures.ts'
import { filterFromSearchParams, filterToSearchParams } from './filter-url.ts'

/**
 * The live filter ⇄ URL query string, so a filtered board is shareable by
 * copying the link. Encoding uses repeated params for arrays (no delimiter to
 * escape); decoding re-validates through the schema (a trust boundary).
 */
describe('filter-url', () => {
  it('round-trips a fully-populated filter through the query string', () => {
    // Arrange — every facet set, incl. a tag + a free-text query carrying a
    // comma / ampersand / spaces (the characters a naive delimiter would break).
    const filter: BoardFilter = {
      priorities: ['P0', 'P2'],
      assigneeIds: [uid(1), uid(2)],
      reporterIds: [uid(3)],
      tags: ['HVAC', 'needs, parts'],
      locationIds: [uid(4)],
      scope: 'archived',
      q: 'leaking faucet & pump',
      overdue: true,
    }
    // Act — encode then decode.
    const result = filterFromSearchParams(filterToSearchParams(filter))
    // Assert — identical after the URL round-trip, arrays in order.
    expect(result).toEqual(filter)
  })

  it('encodes the empty filter as an empty query string (a clean URL)', () => {
    // Arrange
    const filter = EMPTY_BOARD_FILTER
    // Act
    const params = filterToSearchParams(filter)
    // Assert — nothing to share means a bare `/`.
    expect(params.toString()).toBe('')
  })

  it('decodes an empty query string as the empty filter', () => {
    // Arrange
    const params = new URLSearchParams('')
    // Act
    const result = filterFromSearchParams(params)
    // Assert
    expect(result).toEqual(EMPTY_BOARD_FILTER)
  })

  it('falls back to the empty filter when a param no longer parses (trust boundary)', () => {
    // Arrange — a hand-edited / stale link with an unknown priority.
    const params = new URLSearchParams('priority=NOPE&q=keep')
    // Act
    const result = filterFromSearchParams(params)
    // Assert — the whole filter safely resets rather than throwing or querying junk.
    expect(result).toEqual(EMPTY_BOARD_FILTER)
  })
})

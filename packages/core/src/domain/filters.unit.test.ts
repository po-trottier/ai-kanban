import { describe, expect, it } from 'vitest'
import {
  boardFilterSchema,
  BUILTIN_FILTER_PRESETS,
  EMPTY_BOARD_FILTER,
  updateFilterPresetInputSchema,
} from './filters.ts'

describe('boardFilterSchema', () => {
  it('fills every facet with its empty value so `{}` is the full board', () => {
    // Arrange — the empty input.
    const input = {}

    // Act
    const filter = boardFilterSchema.parse(input)

    // Assert — a preset can always set the COMPLETE state; nothing is undefined.
    expect(filter).toEqual({
      priorities: [],
      laneKeys: [],
      assigneeIds: [],
      reporterIds: [],
      tags: [],
      locationIds: [],
      scope: 'active',
      q: '',
      overdue: false,
    })
    expect(EMPTY_BOARD_FILTER).toEqual(filter)
  })

  it('rejects unknown facets (strict) and invalid enum values', () => {
    // Arrange
    const bad = [{ nope: true }, { scope: 'trashed' }, { priorities: ['P9'] }]

    // Act
    const parses = bad.map((input) => () => boardFilterSchema.parse(input))

    // Assert
    for (const parse of parses) expect(parse).toThrow()
  })
})

describe('BUILTIN_FILTER_PRESETS', () => {
  it('exposes My Cards and Overdue as complete BoardFilter values', () => {
    // Arrange
    const byKey = new Map(BUILTIN_FILTER_PRESETS.map((preset) => [preset.key, preset]))

    // Act
    const roundTripped = BUILTIN_FILTER_PRESETS.map((preset) =>
      boardFilterSchema.parse(preset.filter),
    )

    // Assert — each built-in filter is a full, valid BoardFilter.
    expect(byKey.get('overdue')?.filter.overdue).toBe(true)
    expect(byKey.get('my_cards')?.filter.assigneeIds).toEqual([])
    expect(roundTripped).toEqual(BUILTIN_FILTER_PRESETS.map((preset) => preset.filter))
  })
})

describe('updateFilterPresetInputSchema', () => {
  it('requires at least one of name or filter', () => {
    // Arrange
    const empty = {}
    const nameOnly = { name: 'Renamed' }

    // Act
    const parseEmpty = () => updateFilterPresetInputSchema.parse(empty)
    const parsed = updateFilterPresetInputSchema.parse(nameOnly)

    // Assert
    expect(parseEmpty).toThrow()
    expect(parsed).toEqual({ name: 'Renamed' })
  })
})

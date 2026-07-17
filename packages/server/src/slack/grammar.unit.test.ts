import { describe, expect, it } from 'vitest'
import { parseMentionCommand } from './grammar.ts'

describe('parseMentionCommand', () => {
  it('parses an explicit priority and title, stripping the bot mention', () => {
    // Arrange
    const text = '<@UBOT001> create ticket P1 Compressor leaking in bay 4'

    // Act
    const command = parseMentionCommand(text)

    // Assert
    expect(command).toEqual({ priority: 'P1', title: 'Compressor leaking in bay 4' })
  })

  it('defaults the priority to P2 when omitted', () => {
    // Arrange
    const text = '<@UBOT001> create ticket Broken door handle'

    // Act
    const command = parseMentionCommand(text)

    // Assert
    expect(command).toEqual({ priority: 'P2', title: 'Broken door handle' })
  })

  it('matches the command and priority case-insensitively', () => {
    // Arrange
    const text = '<@UBOT001> CREATE Ticket p0 Sparks from the main panel'

    // Act
    const command = parseMentionCommand(text)

    // Assert
    expect(command).toEqual({ priority: 'P0', title: 'Sparks from the main panel' })
  })

  it('truncates the title to 200 characters', () => {
    // Arrange
    const text = `create ticket ${'x'.repeat(300)}`

    // Act
    const command = parseMentionCommand(text)

    // Assert
    expect(command?.title).toHaveLength(200)
  })

  it('keeps a title that merely starts with a priority-like word', () => {
    // Arrange
    const text = 'create ticket P2000 units need inspection'

    // Act
    const command = parseMentionCommand(text)

    // Assert
    expect(command).toEqual({ priority: 'P2', title: 'P2000 units need inspection' })
  })

  it('returns null for anything that does not match the grammar', () => {
    // Arrange
    const samples = [
      '<@UBOT001> hello there',
      '<@UBOT001> create ticket',
      '<@UBOT001> create ticket P1',
      '<@UBOT001>',
      '',
    ]

    // Act
    const results = samples.map(parseMentionCommand)

    // Assert
    expect(results).toEqual([null, null, null, null, null])
  })
})

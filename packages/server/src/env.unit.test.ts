import { describe, expect, it } from 'vitest'
import { parseEnv } from './env.ts'

describe('parseEnv', () => {
  it('applies documented defaults when values are absent', () => {
    // Arrange
    const source = {}

    // Act
    const env = parseEnv(source)

    // Assert
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      PUBLIC_BASE_URL: 'http://localhost:3000',
      TRUST_PROXY_HOPS: 0,
      SEED_DEMO_DATA: false,
      SLACK_ENABLED: false,
      LOG_LEVEL: 'info',
      APP_VERSION: 'dev',
    })
  })

  it('coerces numeric and boolean strings', () => {
    // Arrange
    const source = { PORT: '8080', TRUST_PROXY_HOPS: '2', SEED_DEMO_DATA: 'true' }

    // Act
    const env = parseEnv(source)

    // Assert
    expect(env.PORT).toBe(8080)
    expect(env.TRUST_PROXY_HOPS).toBe(2)
    expect(env.SEED_DEMO_DATA).toBe(true)
  })

  it('treats empty strings as absent (cleared env-file lines)', () => {
    // Arrange
    const source = { SLACK_BOT_TOKEN: '', LOG_LEVEL: '' }

    // Act
    const env = parseEnv(source)

    // Assert
    expect(env.SLACK_BOT_TOKEN).toBeUndefined()
    expect(env.LOG_LEVEL).toBe('info')
  })

  it('refuses to boot on malformed values, naming every violation', () => {
    // Arrange
    const source = { PORT: 'not-a-port', PUBLIC_BASE_URL: 'not-a-url' }

    // Act
    const act = () => parseEnv(source)

    // Assert
    expect(act).toThrow(/refusing to boot/)
    expect(act).toThrow(/PORT/)
    expect(act).toThrow(/PUBLIC_BASE_URL/)
  })

  it('requires the Slack trio when SLACK_ENABLED=true', () => {
    // Arrange
    const source = { SLACK_ENABLED: 'true', SLACK_BOT_TOKEN: 'xoxb-1' }

    // Act
    const act = () => parseEnv(source)

    // Assert
    expect(act).toThrow(/SLACK_APP_TOKEN is required/)
    expect(act).toThrow(/SLACK_TEAM_ID is required/)
  })

  it('accepts SEED_DEMO_PASSWORD outside production within the password bounds', () => {
    // Arrange
    const source = { NODE_ENV: 'development', SEED_DEMO_PASSWORD: 'demo-password-123' }

    // Act
    const env = parseEnv(source)

    // Assert
    expect(env.SEED_DEMO_PASSWORD).toBe('demo-password-123')
  })

  it('rejects a SEED_DEMO_PASSWORD shorter than the 12-character policy minimum', () => {
    // Arrange
    const source = { SEED_DEMO_PASSWORD: 'too-short' }

    // Act
    const act = () => parseEnv(source)

    // Assert
    expect(act).toThrow(/SEED_DEMO_PASSWORD/)
  })

  it('refuses SEED_DEMO_PASSWORD in production mode', () => {
    // Arrange
    const source = { NODE_ENV: 'production', SEED_DEMO_PASSWORD: 'demo-password-123' }

    // Act
    const act = () => parseEnv(source)

    // Assert
    expect(act).toThrow(/SEED_DEMO_PASSWORD is refused in production mode/)
  })

  it('requires ANTHROPIC_API_KEY when the summarizer is enabled', () => {
    // Arrange
    const source = { SUMMARIZER_ENABLED: 'true' }

    // Act
    const act = () => parseEnv(source)

    // Assert
    expect(act).toThrow(/ANTHROPIC_API_KEY is required/)
  })
})

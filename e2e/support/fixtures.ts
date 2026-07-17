import { test as base } from '@playwright/test'
import { randomInt } from 'node:crypto'

/**
 * The e2e server runs with TRUST_PROXY_HOPS=1, so each test can present its
 * own client IP via X-Forwarded-For — per-IP rate-limit buckets (global,
 * login) then behave per-user exactly like production behind the reverse
 * proxy, instead of every browser context sharing 127.0.0.1 and tripping the
 * login budget across unrelated specs. Exported for the secondary contexts
 * some specs open (see `newRoleContext` in ui.ts), which would otherwise
 * bypass the fixture and share the 127.0.0.1 login budget.
 */
export function testClientIp(): string {
  const octet = () => randomInt(1, 250)
  return `10.${String(octet())}.${String(octet())}.${String(octet())}`
}

export const test = base.extend({
  extraHTTPHeaders: async ({}, use) => {
    await use({ 'x-forwarded-for': testClientIp() })
  },
})

export { expect } from '@playwright/test'

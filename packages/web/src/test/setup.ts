import '@testing-library/jest-dom/vitest'
import { notifications } from '@mantine/notifications'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Auto-cleanup does not hook itself without vitest globals; do it explicitly.
// The notifications store is a module singleton — drain it so toasts from one
// test cannot crowd out the next test's (display limit is 5).
afterEach(() => {
  cleanup()
  notifications.clean()
  notifications.cleanQueue()
})

/**
 * happy-dom gap: `document.fonts` (FontFaceSet) is missing but Mantine's
 * autosize Textarea listens to it. Hand-written polyfill per ADR-016 (no
 * vi.stubGlobal — mocking APIs are banned repo-wide).
 */
class FontFaceSetPolyfill extends EventTarget {
  readonly status = 'loaded'
  readonly ready = Promise.resolve(this)
}

if (!('fonts' in document)) {
  Object.defineProperty(document, 'fonts', { value: new FontFaceSetPolyfill() })
}

/**
 * happy-dom gap: no `EventSource`. The app only needs construct/close in
 * component tests (hint handling is tested through `connectStream` with an
 * injected fake source).
 */
class EventSourcePolyfill {
  onopen: unknown = null
  onerror: unknown = null
  onmessage: unknown = null
  readonly readyState = 0 // CONNECTING — the polyfill never connects or errors
  readonly url: string

  constructor(url: string) {
    this.url = url
  }

  close(): void {
    // Nothing to release — the polyfill never connects.
  }
}

if (!('EventSource' in globalThis)) {
  Object.defineProperty(globalThis, 'EventSource', { value: EventSourcePolyfill })
}

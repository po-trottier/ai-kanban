/**
 * Rivian hero/adventure backdrops for the auth screen (Rivian's own imagery,
 * for brand consistency). Self-hosted under /public/auth so the login page
 * makes NO third-party request and needs no CSP relaxation. One is picked at
 * random per visit for variety.
 *
 * Keep in sync with the `bg-N.jpg` files in packages/web/public/auth/.
 */
const AUTH_BACKGROUND_COUNT = 16

const AUTH_BACKGROUNDS = Array.from(
  { length: AUTH_BACKGROUND_COUNT },
  (_unused, index) => `/auth/bg-${String(index + 1)}.jpg`,
)

export function randomAuthBackground(): string {
  const index = Math.floor(Math.random() * AUTH_BACKGROUNDS.length)
  return AUTH_BACKGROUNDS[index] ?? '/auth/bg-1.jpg'
}

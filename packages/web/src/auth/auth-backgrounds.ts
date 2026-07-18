/**
 * Rivian-adventure backdrops for the auth screen. Self-hosted from /public so
 * the security-sensitive login page makes NO third-party request and needs no
 * CSP relaxation (sourced from Unsplash under its hotlink-permissive license,
 * then committed). One is picked at random per visit.
 */
const AUTH_BACKGROUNDS = [
  '/auth/bg-1.jpg',
  '/auth/bg-2.jpg',
  '/auth/bg-3.jpg',
  '/auth/bg-4.jpg',
] as const

export function randomAuthBackground(): string {
  const index = Math.floor(Math.random() * AUTH_BACKGROUNDS.length)
  return AUTH_BACKGROUNDS[index] ?? AUTH_BACKGROUNDS[0]
}

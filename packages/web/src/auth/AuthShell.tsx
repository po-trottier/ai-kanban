import { useState, type ReactNode } from 'react'
import { randomAuthBackground } from './auth-backgrounds.ts'
import classes from './auth.module.css'

/**
 * Full-viewport auth backdrop: a random self-hosted Rivian-adventure photo
 * under a dark scrim, with the card centered above it. Shared by the sign-in
 * and first-boot setup screens.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  // Pick once per mount so the photo doesn't flip on every re-render.
  const [background] = useState(randomAuthBackground)
  return (
    <div className={classes.screen} style={{ backgroundImage: `url("${background}")` }}>
      <div className={classes.scrim} />
      <div className={classes.card}>{children}</div>
    </div>
  )
}

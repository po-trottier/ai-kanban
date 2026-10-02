import { type ReactNode } from 'react'
import classes from './auth.module.css'

/** Shared full-viewport backdrop for sign-in and first-boot setup. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className={classes.screen}>
      <div className={classes.scrim} />
      <div className={classes.card}>{children}</div>
    </div>
  )
}

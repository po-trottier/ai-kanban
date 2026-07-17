import { useEffect, useState } from 'react'

/**
 * The current time, refreshed on an interval so time-derived UI (the work
 * burn-down bar) stays live without a manual refresh. Cheap: one timer per
 * mounted consumer, and only the consumers re-render on each tick.
 */
export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date())
    }, intervalMs)
    return () => {
      clearInterval(id)
    }
  }, [intervalMs])
  return now
}

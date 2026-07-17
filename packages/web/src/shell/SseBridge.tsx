import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { API_BASE } from '../api/client.ts'
import { connectStream } from '../api/sse.ts'

/** Opens the SSE hint stream for the life of the authenticated shell (ADR-008). */
export function SseBridge() {
  const queryClient = useQueryClient()
  useEffect(() => {
    // happy-dom has no EventSource; the stream is a browser-runtime concern.
    if (typeof EventSource === 'undefined') return
    return connectStream(queryClient, () => new EventSource(`${API_BASE}/stream`))
  }, [queryClient])
  return null
}

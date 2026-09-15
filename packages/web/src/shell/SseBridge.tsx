import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { API_BASE } from '../api/client.ts'
import { useGlobalQueryClient } from '../api/global-api-context.ts'
import { connectStream } from '../api/sse.ts'

/**
 * Opens the SSE hint stream for the life of the authenticated shell (ADR-008).
 * `useQueryClient()` reads whichever client is ambient here (the board-scoped
 * one); `useGlobalQueryClient()` is always the root client — hints route to
 * whichever cache actually holds the affected query (api/sse.ts).
 */
export function SseBridge({ boardId }: { boardId: string | null }) {
  const scopedQueryClient = useQueryClient()
  const globalQueryClient = useGlobalQueryClient()
  useEffect(() => {
    // happy-dom has no EventSource; the stream is a browser-runtime concern.
    if (typeof EventSource === 'undefined') return
    if (boardId === null) return
    const url = `${API_BASE}/stream?boardId=${encodeURIComponent(boardId)}`
    return connectStream(scopedQueryClient, globalQueryClient, () => new EventSource(url))
  }, [scopedQueryClient, globalQueryClient, boardId])
  return null
}

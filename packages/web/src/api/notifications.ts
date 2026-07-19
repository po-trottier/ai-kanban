import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { strings } from '../strings.ts'
import { useApi } from './api-context.ts'
import { queryKeys } from './keys.ts'
import { notifyError, notifySuccess } from './notify.ts'
import { notificationsResponseSchema, unreadCountResponseSchema } from './schemas.ts'

/** Poll the inbox as a backstop; card SSE hints also invalidate it for near-instant refresh. */
const POLL_MS = 30_000

/** The acting user's notifications, newest-first (optionally unread-only). */
export function useNotifications(unreadOnly: boolean) {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.notifications(unreadOnly),
    queryFn: () =>
      api.get(`/notifications${unreadOnly ? '?unreadOnly=true' : ''}`, notificationsResponseSchema),
    refetchInterval: POLL_MS,
    placeholderData: keepPreviousData,
  })
}

/** The unread count for the bell badge (cheap, polled). */
export function useUnreadCount() {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.notificationsUnread,
    queryFn: () => api.get('/notifications/unread-count', unreadCountResponseSchema),
    refetchInterval: POLL_MS,
  })
}

/** Marks one notification read (no toast — this fires on open/click). */
export function useMarkNotificationRead() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.postVoid(`/notifications/${id}/read`),
    onSuccess: () => {
      // Refetch every notification query + the unread badge (shared prefix).
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: notifyError,
  })
}

/** Marks the whole inbox read (bulk action). */
export function useMarkAllNotificationsRead() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.postVoid('/notifications/read-all'),
    onSuccess: () => {
      notifySuccess(strings.notifications.allRead)
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: notifyError,
  })
}

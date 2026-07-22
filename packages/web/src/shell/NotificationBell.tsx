import { type NotificationKind, type NotificationView } from '@rivian-kanban/core'
import {
  ActionIcon,
  Box,
  Divider,
  Group,
  Indicator,
  Popover,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import { Bell, Mail, X } from 'lucide-react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { cx } from '../lib/cx.ts'
import {
  useClearAllNotifications,
  useClearNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useMarkNotificationUnread,
  useNotifications,
  useUnreadCount,
} from '../api/notifications.ts'
import { useUserTimezone } from '../auth/session-context.ts'
import { formatDateTime, formatTicketNumber } from '../lib/format.ts'
import { strings } from '../strings.ts'
import { EMPHASIS_FONT_WEIGHT } from '../theme.ts'
import { HintButton } from './HintButton.tsx'
import classes from './notification-bell.module.css'

/**
 * The header notification inbox (docs/architecture/notifications.md). A bell with
 * an unread badge opens a popover listing the acting user's notifications
 * newest-first, filterable to unread-only. Opening a card marks that
 * notification read; a bulk "Mark all as read" clears the badge. The inbox
 * polls (30s) and refetches on card SSE hints, so new notifications appear
 * without a reload.
 */
export function NotificationBell() {
  const [opened, setOpened] = useState(false)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const unreadQuery = useUnreadCount()
  const notificationsQuery = useNotifications(unreadOnly)
  const markRead = useMarkNotificationRead()
  const markUnread = useMarkNotificationUnread()
  const markAll = useMarkAllNotificationsRead()
  const clearOne = useClearNotification()
  const clearAll = useClearAllNotifications()
  const navigate = useNavigate()
  const location = useLocation()
  const timezone = useUserTimezone()

  const unread = unreadQuery.data?.unread ?? 0
  const items = notificationsQuery.data ?? []

  const openCard = (notification: NotificationView) => {
    if (!notification.read) markRead.mutate(notification.id)
    setOpened(false)
    // Preserve the board filter query (URL state); a mention / comment
    // notification also deep-links to the comments tab + its specific comment,
    // which CommentsThread then jumps to and flashes.
    const search = new URLSearchParams(location.search)
    if (notification.commentId != null) {
      search.set('tab', 'comments')
      search.set('comment', notification.commentId)
    }
    void navigate({ pathname: `/cards/${String(notification.cardId)}`, search: search.toString() })
  }

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      width={360}
      withArrow
      shadow="md"
    >
      <Popover.Target>
        <Indicator
          disabled={unread === 0}
          label={unread > 99 ? '99+' : String(unread)}
          size={16}
          color="red"
          offset={4}
        >
          <Tooltip label={strings.notifications.bellLabel}>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              aria-label={
                unread > 0
                  ? strings.notifications.bellWithUnread(unread)
                  : strings.notifications.bellLabel
              }
              onClick={() => {
                setOpened((value) => !value)
              }}
            >
              <Bell size={20} aria-hidden />
            </ActionIcon>
          </Tooltip>
        </Indicator>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        <Group justify="space-between" p="sm" wrap="nowrap">
          <Text fw={EMPHASIS_FONT_WEIGHT}>{strings.notifications.title}</Text>
          <SegmentedControl
            size="xs"
            value={unreadOnly ? 'unread' : 'all'}
            onChange={(value) => {
              setUnreadOnly(value === 'unread')
            }}
            data={[
              { value: 'all', label: strings.notifications.filterAll },
              { value: 'unread', label: strings.notifications.filterUnread },
            ]}
          />
        </Group>
        <Divider />
        <ScrollArea.Autosize mah={380} type="scroll">
          {items.length === 0 ? (
            <Text size="sm" c="dimmed" p="xl" ta="center">
              {unreadOnly ? strings.notifications.emptyUnread : strings.notifications.empty}
            </Text>
          ) : (
            <Stack gap={0}>
              {items.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  timezone={timezone}
                  clearing={clearOne.isPending && clearOne.variables === notification.id}
                  markingUnread={markUnread.isPending && markUnread.variables === notification.id}
                  onOpen={() => {
                    openCard(notification)
                  }}
                  onMarkUnread={() => {
                    markUnread.mutate(notification.id)
                  }}
                  onClear={() => {
                    clearOne.mutate(notification.id)
                  }}
                />
              ))}
            </Stack>
          )}
        </ScrollArea.Autosize>
        <Divider />
        <Group justify="space-between" p="xs">
          <HintButton
            size="xs"
            variant="subtle"
            color="red"
            tooltip={strings.notifications.clearAllTooltip}
            disabledReason={items.length === 0 ? strings.notifications.clearAllEmpty : undefined}
            loading={clearAll.isPending}
            onClick={() => {
              clearAll.mutate()
            }}
          >
            {strings.notifications.clearAll}
          </HintButton>
          <HintButton
            size="xs"
            variant="subtle"
            tooltip={strings.notifications.markAllReadTooltip}
            disabledReason={unread === 0 ? strings.notifications.markAllReadEmpty : undefined}
            loading={markAll.isPending}
            onClick={() => {
              markAll.mutate()
            }}
          >
            {strings.notifications.markAllRead}
          </HintButton>
        </Group>
      </Popover.Dropdown>
    </Popover>
  )
}

/**
 * One inbox row: who did what, on which card, when — bold + tinted while unread.
 * The content is the click target (opens the card + marks read); a trailing ✕
 * clears the notification outright. Two separate controls, never nested buttons.
 */
function NotificationRow({
  notification,
  timezone,
  clearing,
  markingUnread,
  onOpen,
  onMarkUnread,
  onClear,
}: {
  notification: NotificationView
  timezone: string
  clearing: boolean
  markingUnread: boolean
  onOpen: () => void
  onMarkUnread: () => void
  onClear: () => void
}) {
  const actor = notification.actorName ?? strings.notifications.systemActor
  const verbs: Partial<Record<NotificationKind, string>> = strings.notifications.verbs
  const verb = verbs[notification.eventType] ?? strings.notifications.verbFallback
  return (
    <Group
      className={cx(classes.row, !notification.read && classes.unread)}
      gap="xs"
      wrap="nowrap"
      p="sm"
      align="flex-start"
    >
      <UnstyledButton
        className={classes.rowContent}
        onClick={onOpen}
        aria-label={`${actor} ${verb}: ${formatTicketNumber(notification.cardId)} ${notification.cardTitle}`}
      >
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text size="sm" lineClamp={2}>
            <Text span fw={EMPHASIS_FONT_WEIGHT}>
              {actor}
            </Text>{' '}
            {verb}
          </Text>
          <Text size="xs" c="dimmed" lineClamp={1}>
            {`${formatTicketNumber(notification.cardId)} — ${notification.cardTitle}`}
          </Text>
          <Text size="xs" c="dimmed">
            {formatDateTime(notification.createdAt, timezone)}
          </Text>
        </Stack>
      </UnstyledButton>
      {notification.read ? (
        // A read row can be flipped BACK to unread ("come back later") — an
        // envelope, the conventional mark-unread affordance.
        <Tooltip label={strings.notifications.markUnreadTooltip} withArrow>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label={strings.notifications.markUnread(notification.cardTitle)}
            loading={markingUnread}
            onClick={onMarkUnread}
          >
            <Mail size={16} aria-hidden />
          </ActionIcon>
        </Tooltip>
      ) : (
        // Unread dot in the theme PRIMARY color (the app's indigo, rgb(59,91,219)
        // = --mantine-primary-color-filled) — the crisp per-row "unread" marker.
        <Box
          aria-hidden
          w={8}
          h={8}
          mt={6}
          style={{ borderRadius: '50%', backgroundColor: 'var(--mantine-primary-color-filled)' }}
        />
      )}
      <Tooltip label={strings.notifications.clearTooltip} withArrow>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          aria-label={strings.notifications.clear(notification.cardTitle)}
          loading={clearing}
          onClick={onClear}
        >
          <X size={16} aria-hidden />
        </ActionIcon>
      </Tooltip>
    </Group>
  )
}

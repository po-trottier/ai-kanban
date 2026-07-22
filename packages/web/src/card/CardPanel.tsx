import {
  ActionIcon,
  Alert,
  Badge,
  Divider,
  Group,
  Select,
  Skeleton,
  Stack,
  Tabs,
  Text,
  Tooltip,
  VisuallyHidden,
} from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { Bell, BellOff, RotateCcw, Save, ShieldOff } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { WAITING_REASONS, type Card, type WaitingReason } from '@rivian-kanban/core'
import { useBoard, useCardAction, useUpdateCard } from '../api/board.ts'
import { useCardWatch, useUnwatchCard, useWatchCard } from '../api/watch.ts'
import {
  useAddComment,
  useCardDetail,
  useCardEvents,
  useComments,
  useDeleteComment,
  useEditComment,
} from '../api/card.ts'
import { usePolicy, useUsers } from '../api/meta.ts'
import { useCurrentUser, useUserTimezone } from '../auth/session-context.ts'
import { CardBadges } from '../board/CardBadges.tsx'
import { isWorkOverdue } from '../board/card-status.ts'
import { canPerformAction } from '../board/move-options.ts'
import { formatEstimate, formatTicketNumber, todayInTimezone, utcToday } from '../lib/format.ts'
import { useNow } from '../lib/use-now.ts'
import { workProgress } from '../lib/work-progress.ts'
import { CloseIcon } from '../shell/icons.tsx'
import { useCardPanelSlot } from '../shell/card-panel-slot.ts'
import { ErrorAlert } from '../shell/ErrorAlert.tsx'
import { HintButton } from '../shell/HintButton.tsx'
import { strings } from '../strings.ts'
import {
  BLOCKED_COLOR,
  CANCELLED_COLOR,
  EMPHASIS_FONT_WEIGHT,
  OVERDUE_COLOR,
  PRIORITY_COLORS,
  SIZES,
  WAITING_COLOR,
} from '../theme.ts'
import { isOverdueResume } from '@rivian-kanban/core'
import { CardBody } from './CardBody.tsx'
import { CommentsThread } from './CommentsThread.tsx'
import { HistoryList } from './HistoryList.tsx'
import classes from './card.module.css'

/**
 * The deep-linked `/cards/:cardId` route element. It renders NOTHING itself —
 * it just publishes the open card id to the shell so AppLayout can dock the
 * panel in its AppShell.Aside (below the header, not overlaying it). Clearing
 * on unmount closes the Aside when the route changes (Escape / ✕ / navigate).
 */
export function CardPanelRoute() {
  const { cardId = '' } = useParams()
  const { setOpenCardId } = useCardPanelSlot()

  useEffect(() => {
    setOpenCardId(cardId)
    return () => {
      setOpenCardId(null)
    }
  }, [cardId, setOpenCardId])

  return null
}

/**
 * The docked card detail panel body (rendered inside AppShell.Aside). Keeps
 * the dialog accessible name (tests target `role="dialog"` named "Card
 * details"), Escape + ✕ close, and full-screen behavior at the small
 * breakpoint (the Aside's own breakpoint handles the width).
 */
export function CardPanel({ cardId }: { cardId: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const labelId = useId()
  const detailQuery = useCardDetail(cardId)
  const card = detailQuery.data?.card

  // Back to the board, PRESERVING the filter query (the live filter is URL
  // state) so closing the panel restores the same filtered board it opened over.
  const close = () => {
    void navigate({ pathname: '/', search: location.search })
  }

  // Escape closes the panel regardless of where focus sits (the docked Aside
  // is not a focus-trapping overlay like the old Drawer, so a window listener
  // preserves the same keyboard-close behavior the tests rely on). But when a
  // nested Mantine Modal is open inside the panel (e.g. the delete-comment
  // confirm), Escape must dismiss only THAT dialog. Mantine closes it on its
  // own bubble-phase window listener, so we register in the CAPTURE phase —
  // which always runs first, before Mantine can synchronously flush the modal
  // away — and bail while any Mantine Modal is OPEN. We probe `.mantine-Modal-
  // content` (the dialog box, rendered only while open) rather than `-root`:
  // Mantine keeps a closed modal's root wrapper mounted (e.g. the header badge-
  // legend modal), so a `-root` probe would wrongly conclude a modal is open
  // and swallow every Escape. This keeps the whole card open when a user hits
  // Escape to back out of a confirm dialog, while still closing on a bare Escape.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (document.querySelector('.mantine-Modal-content') !== null) return
      void navigate({ pathname: '/', search: location.search })
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
    }
  }, [navigate, location.search])

  return (
    <div
      role="dialog"
      // Labelled by the header (the hidden "Card details" + title + priority),
      // so assistive tech and the tests get the same combined accessible name
      // the old Drawer produced — never overridden by an aria-label.
      aria-labelledby={`${labelId} ${labelId}-priority`}
      className={classes.panel}
    >
      <Group justify="space-between" wrap="nowrap" gap="xs" p="md" className={classes.panelHeader}>
        <Group id={labelId} gap="xs" wrap="nowrap" className={classes.panelTitle}>
          {/* Named for assistive tech and the selectors that target the panel.
              The VisuallyHidden alone supplies the accessible name during load —
              no visible duplicate, so the name never doubles to "Card details
              Card details". A dimmed placeholder fills the header while loading. */}
          <VisuallyHidden>{strings.detail.panelLabel}</VisuallyHidden>
          {card === undefined ? (
            <Text fw={EMPHASIS_FONT_WEIGHT} c="dimmed" aria-hidden>
              {strings.common.loading}
            </Text>
          ) : (
            <>
              <Text fw={EMPHASIS_FONT_WEIGHT} c="dimmed">
                {formatTicketNumber(card.id)}
              </Text>
              <Text fw={EMPHASIS_FONT_WEIGHT} lineClamp={1}>
                {card.title}
              </Text>
            </>
          )}
        </Group>
        {/* Priority sits on the RIGHT to match the board card (the source of
            truth), not beside the title. It stays in the panel's accessible
            name via aria-labelledby, so the combined name is unchanged. */}
        <Group gap="xs" wrap="nowrap">
          {card === undefined ? null : (
            <Badge
              id={`${labelId}-priority`}
              color={PRIORITY_COLORS[card.priority]}
              size="sm"
              variant="filled"
              // Fixed width (theme token) so the badge never collapses to nothing
              // or shifts the header — all priority labels are the same length.
              w={SIZES.priorityBadgeWidth}
              style={{ flexShrink: 0 }}
            >
              {strings.priorities[card.priority]}
            </Badge>
          )}
          <WatchToggle cardId={cardId} />
          <Tooltip label={strings.detail.closeLabel}>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              aria-label={strings.detail.closeLabel}
              onClick={close}
            >
              <CloseIcon />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <Divider />
      <div className={classes.panelBody}>
        <CardPanelBody cardId={cardId} />
      </div>
    </div>
  )
}

/**
 * Watch / unwatch this card — controls whether its changes reach your
 * notifications (docs/architecture/notifications.md). The bell reflects the
 * CURRENT state (on = watching); the label + tooltip name the action.
 */
export function WatchToggle({ cardId }: { cardId: string }) {
  const watchQuery = useCardWatch(cardId)
  const watchCard = useWatchCard(cardId)
  const unwatchCard = useUnwatchCard(cardId)
  const watching = watchQuery.data?.watching ?? false
  return (
    <Tooltip label={watching ? strings.watch.tooltipUnwatch : strings.watch.tooltipWatch}>
      <ActionIcon
        variant={watching ? 'light' : 'subtle'}
        color={watching ? 'blue' : 'gray'}
        size="lg"
        aria-label={watching ? strings.watch.unwatch : strings.watch.watch}
        aria-pressed={watching}
        loading={watchCard.isPending || unwatchCard.isPending}
        disabled={watchQuery.isPending}
        onClick={() => {
          if (watching) unwatchCard.mutate()
          else watchCard.mutate()
        }}
      >
        {watching ? <Bell size={18} aria-hidden /> : <BellOff size={18} aria-hidden />}
      </ActionIcon>
    </Tooltip>
  )
}

function CardPanelBody({ cardId }: { cardId: string }) {
  const me = useCurrentUser()
  const detailQuery = useCardDetail(cardId)
  const commentsQuery = useComments(cardId)
  const eventsQuery = useCardEvents(cardId)
  const usersQuery = useUsers()
  const boardQuery = useBoard()
  const policyQuery = usePolicy()

  const updateCard = useUpdateCard()
  const cardAction = useCardAction()
  const addComment = useAddComment(cardId)
  const editComment = useEditComment(cardId)
  const deleteComment = useDeleteComment(cardId)

  // A mention / comment notification deep-links with `?tab=comments&comment=<id>`
  // (CommentsThread then jumps to + flashes the comment). Tabs are controlled;
  // the initial tab is lazily read from the URL so a deep-link opens Comments on
  // mount, and thereafter it's local (manual switches). A normal open with no
  // params defaults to details.
  const [searchParams, setSearchParams] = useSearchParams()
  const focusCommentId = searchParams.get('comment') ?? undefined
  const [tab, setTab] = useState<string | null>(() =>
    searchParams.get('tab') === 'comments' || searchParams.get('comment') !== null
      ? 'comments'
      : 'details',
  )
  const clearCommentDeepLink = () => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('tab')
        next.delete('comment')
        return next
      },
      { replace: true },
    )
  }

  if (detailQuery.isPending) {
    return <CardPanelSkeleton />
  }
  if (detailQuery.data === undefined) {
    return <ErrorAlert error={detailQuery.error} fallbackMessage={strings.detail.loadFailed} />
  }

  const detail = detailQuery.data
  const users = usersQuery.data ?? []
  const userNames = new Map(users.map((user) => [user.id, user.displayName]))
  const laneLabels = Object.fromEntries(
    (boardQuery.data?.lanes ?? []).map((snapshot) => [snapshot.lane.key, snapshot.lane.label]),
  )
  // The card's current lane key — drives the work-overdue banner (only working lanes).
  const laneKey =
    boardQuery.data?.lanes.find((snapshot) => snapshot.lane.id === detail.card.laneId)?.lane.key ??
    null
  const events = (eventsQuery.data?.pages ?? []).flatMap((page) => page.items)
  const policy = policyQuery.data
  // Policy affordances (ADR-013): under-afford until the policy arrives.
  const canDeleteOthersComments =
    policy !== undefined && canPerformAction(policy, me.role, 'deleteOthersComments')
  const canReopen = policy !== undefined && canPerformAction(policy, me.role, 'reopen')
  const canUnblock = detail.card.blocked
  // Archived cards are read-only except reopen (workflow.md#terminal-states).
  const archived = detail.card.archivedAt !== null

  return (
    <Stack gap="md">
      <StateBanner
        card={detail.card}
        laneKey={laneKey}
        canReopen={canReopen}
        canUnblock={canUnblock}
        acting={cardAction.isPending}
        savingWaiting={updateCard.isPending}
        onReopen={() => {
          cardAction.mutate({ card: detail.card, action: 'reopen' })
        }}
        onUnblock={() => {
          cardAction.mutate({ card: detail.card, action: 'unblock' })
        }}
        onSaveWaiting={(changes) => {
          updateCard.mutate({ card: detail.card, changes })
        }}
      />
      {/* Priority lives in the panel header; this row carries status only. */}
      <CardBadges card={detail.card} today={utcToday()} showPriority={false} />
      {archived ? (
        <Group justify="space-between" gap="sm">
          <Text size="sm" c="dimmed">
            {strings.detail.archivedNotice}
          </Text>
          <HintButton
            size="xs"
            variant="light"
            tooltip={strings.tooltips.reopen}
            disabledReason={canReopen ? undefined : strings.tooltips.disabledReopenNoPermission}
            leftSection={<RotateCcw size={14} aria-hidden />}
            loading={cardAction.isPending}
            onClick={() => {
              cardAction.mutate({ card: detail.card, action: 'reopen' })
            }}
          >
            {strings.card.reopen}
          </HintButton>
        </Group>
      ) : null}
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="details">{strings.detail.tabDetails}</Tabs.Tab>
          <Tabs.Tab value="comments">{strings.detail.tabComments}</Tabs.Tab>
          <Tabs.Tab value="history">{strings.detail.tabHistory}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="details" pt="md">
          <CardBody cardId={cardId} />
        </Tabs.Panel>
        <Tabs.Panel value="comments" pt="md">
          <CommentsThread
            comments={commentsQuery.data ?? []}
            currentUserId={me.id}
            userNames={userNames}
            canDeleteOthers={canDeleteOthersComments}
            readOnly={archived}
            addPending={addComment.isPending}
            editPending={editComment.isPending}
            deletePending={deleteComment.isPending}
            onAdd={(body, parentCommentId, mentions, onPosted) => {
              addComment.mutate(
                {
                  body,
                  ...(parentCommentId === null ? {} : { parentCommentId }),
                  ...(mentions.length > 0 ? { mentions } : {}),
                },
                { onSuccess: onPosted },
              )
            }}
            onEdit={(commentId, body, onEdited) => {
              editComment.mutate({ commentId, input: { body } }, { onSuccess: onEdited })
            }}
            onDelete={(commentId, onDeleted) => {
              deleteComment.mutate(commentId, { onSuccess: onDeleted })
            }}
            {...(focusCommentId !== undefined ? { focusCommentId } : {})}
            onFocusHandled={clearCommentDeepLink}
          />
        </Tabs.Panel>
        <Tabs.Panel value="history" pt="md">
          <HistoryList
            events={events}
            context={{ userNames, laneLabels }}
            hasMore={eventsQuery.hasNextPage}
            loadingMore={eventsQuery.isFetchingNextPage}
            onLoadMore={() => {
              void eventsQuery.fetchNextPage()
            }}
          />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  )
}

/**
 * Ghosts the panel body's eventual shape — a status row, the three tabs, and a
 * few field rows — so opening a card shows its layout instead of a bare spinner
 * that blanks the whole Aside while the detail/comments/events load.
 */
function CardPanelSkeleton() {
  return (
    <Stack gap="md" role="status" aria-label={strings.common.loading} aria-busy>
      <Skeleton height="1.5rem" width="40%" radius="sm" />
      <Group gap="xs">
        <Skeleton height="2rem" width="8rem" radius="sm" />
        <Skeleton height="2rem" width="8rem" radius="sm" />
        <Skeleton height="2rem" width="8rem" radius="sm" />
      </Group>
      <Skeleton height="2.25rem" radius="sm" />
      <Skeleton height="6rem" radius="sm" />
      <Skeleton height="2.25rem" radius="sm" />
    </Stack>
  )
}

/**
 * A prominent colored banner explaining WHY a card is stalled (blocked reason,
 * cancel resolution, waiting reason + resume date) with the inline action to
 * unstick it. A user opening a stalled card must not have to hunt for this.
 */
function StateBanner({
  card,
  laneKey,
  canReopen,
  canUnblock,
  acting,
  savingWaiting,
  onReopen,
  onUnblock,
  onSaveWaiting,
}: {
  card: Card
  /** The card's current lane key — gates the work-overdue banner. */
  laneKey: string | null
  canReopen: boolean
  canUnblock: boolean
  acting: boolean
  savingWaiting: boolean
  onReopen: () => void
  onUnblock: () => void
  onSaveWaiting: (changes: { waitingReason: WaitingReason; expectedResumeAt: string }) => void
}) {
  const cancelled = card.resolution !== null && card.resolution !== 'completed'
  if (card.blocked) {
    return (
      <Alert color={BLOCKED_COLOR} title={strings.detail.blockedBannerTitle}>
        <Stack gap="sm">
          <Text size="sm">{card.blockedReason ?? strings.detail.blockedBannerNoReason}</Text>
          <Group>
            <HintButton
              size="xs"
              variant="white"
              color={BLOCKED_COLOR}
              tooltip={strings.tooltips.unblock}
              disabledReason={canUnblock ? undefined : strings.tooltips.disabledUnblockNotBlocked}
              leftSection={<ShieldOff size={14} aria-hidden />}
              loading={acting}
              onClick={onUnblock}
            >
              {strings.card.unblock}
            </HintButton>
          </Group>
        </Stack>
      </Alert>
    )
  }
  if (cancelled && card.resolution !== null) {
    return (
      <Alert color={CANCELLED_COLOR} title={strings.detail.cancelledBannerTitle[card.resolution]}>
        <Stack gap="sm">
          <Text size="sm">{strings.detail.cancelledBannerBody}</Text>
          <Group>
            <HintButton
              size="xs"
              variant="light"
              tooltip={strings.tooltips.reopen}
              disabledReason={canReopen ? undefined : strings.tooltips.disabledReopenNoPermission}
              leftSection={<RotateCcw size={14} aria-hidden />}
              loading={acting}
              onClick={onReopen}
            >
              {strings.card.reopen}
            </HintButton>
          </Group>
        </Stack>
      </Alert>
    )
  }
  if (card.waitingReason !== null) {
    return <WaitingBanner card={card} saving={savingWaiting} onSave={onSaveWaiting} />
  }
  // An in-progress card past its estimate gets its own banner too (self-nulls
  // when on-track), so overdue reads like every other special state.
  return <WorkOverdueBanner card={card} laneKey={laneKey} />
}

/**
 * The in-progress overdue banner — a card in a working lane whose burn-down has
 * passed its estimate. Purely informational (unlike blocked/cancelled/waiting
 * there is no single "unstick" action): it names the overrun and nudges the
 * user to finish, advance, or re-estimate. Self-nulls when the card is on-track
 * or not being worked, so `StateBanner` can render it unconditionally. Ticks on
 * the burn-down's minute cadence so it appears the moment the card tips over.
 */
function WorkOverdueBanner({ card, laneKey }: { card: Card; laneKey: string | null }) {
  const now = useNow(60_000)
  const timezone = useUserTimezone()
  if (!isWorkOverdue(card, laneKey, now, timezone)) return null
  // isWorkOverdue guarantees both are set; narrow for formatEstimate/workProgress.
  if (card.workStartedAt === null || card.estimateMinutes === null) return null
  const { elapsedMinutes } = workProgress(card.workStartedAt, card.estimateMinutes, now, timezone)
  return (
    <Alert color={OVERDUE_COLOR} title={strings.detail.overdueBannerTitle}>
      <Text size="sm">
        {strings.detail.overdueBannerBody(
          formatEstimate(elapsedMinutes),
          formatEstimate(card.estimateMinutes),
        )}
      </Text>
    </Alert>
  )
}

/**
 * The Waiting on Parts / Vendor banner with an INLINE edit of the reason and
 * expected resume date (docs/product/workflow.md) — no need to move the card
 * out and back in to correct them. Save is enabled only once something differs
 * from the saved values; it PATCHes through `useUpdateCard` (If-Match), and the
 * server re-arms the overdue alert when the date changes. Archived cards never
 * reach here (they carry no waitingReason).
 */
function WaitingBanner({
  card,
  saving,
  onSave,
}: {
  card: Card
  saving: boolean
  onSave: (changes: { waitingReason: WaitingReason; expectedResumeAt: string }) => void
}) {
  const [reason, setReason] = useState<WaitingReason | null>(card.waitingReason)
  const [resumeAt, setResumeAt] = useState<string | null>(card.expectedResumeAt)
  const overdue = isOverdueResume(card.expectedResumeAt, utcToday())

  // A fresh server state (SSE refetch, our own save, or a concurrent edit by
  // another user / the hourly job) re-seeds each field — but only when the user
  // has not diverged it from the last-seen server value, so an in-progress edit
  // survives (the keepDirtyValues semantics the CardDetailsForm inline editor
  // uses). The ref holds the previous server snapshot to test divergence.
  const seenServer = useRef({ reason: card.waitingReason, resumeAt: card.expectedResumeAt })
  useEffect(() => {
    const seen = seenServer.current
    if (card.waitingReason !== seen.reason) {
      setReason((prev) => (prev === seen.reason ? card.waitingReason : prev))
    }
    if (card.expectedResumeAt !== seen.resumeAt) {
      setResumeAt((prev) => (prev === seen.resumeAt ? card.expectedResumeAt : prev))
    }
    seenServer.current = { reason: card.waitingReason, resumeAt: card.expectedResumeAt }
  }, [card.waitingReason, card.expectedResumeAt])

  const timezone = useUserTimezone()
  const dirty =
    reason !== null &&
    resumeAt !== null &&
    (reason !== card.waitingReason || resumeAt !== card.expectedResumeAt)

  // Once the resume date has passed, the whole banner (and its save button) turns
  // the OVERDUE colour — matching the card's overdue badge — instead of staying
  // the regular waiting colour.
  const waitingColor = overdue ? OVERDUE_COLOR : WAITING_COLOR
  return (
    <Alert color={waitingColor} title={strings.detail.waitingBannerTitle}>
      <Stack gap="sm">
        <Text size="sm">
          {overdue ? strings.detail.waitingOverdueNote : strings.detail.waitingEditHint}
        </Text>
        <Select
          label={strings.detail.waitingReasonLabel}
          data={WAITING_REASONS.map((value) => ({
            value,
            label: strings.waiting.reasons[value],
          }))}
          value={reason}
          allowDeselect={false}
          onChange={setReason}
        />
        <DatePickerInput
          label={strings.detail.waitingResumeLabel}
          value={resumeAt}
          onChange={setResumeAt}
          minDate={todayInTimezone(timezone)}
          highlightToday
        />
        <Group justify="flex-end">
          <HintButton
            size="xs"
            variant="white"
            color={waitingColor}
            tooltip={strings.tooltips.saveWaiting}
            disabledReason={dirty ? undefined : strings.tooltips.disabledNoChanges}
            leftSection={<Save size={14} aria-hidden />}
            loading={saving}
            onClick={() => {
              if (reason === null || resumeAt === null) return
              onSave({ waitingReason: reason, expectedResumeAt: resumeAt })
            }}
          >
            {strings.detail.waitingSave}
          </HintButton>
        </Group>
      </Stack>
    </Alert>
  )
}

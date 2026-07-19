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
import { RotateCcw, Save, ShieldOff } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { WAITING_REASONS, type Card, type WaitingReason } from '@rivian-kanban/core'
import { useBoard, useCardAction, useUpdateCard } from '../api/board.ts'
import {
  useAddComment,
  useCardDetail,
  useCardEvents,
  useComments,
  useDeleteAttachment,
  useDeleteComment,
  useEditComment,
  useUploadAttachment,
} from '../api/card.ts'
import { useLocations, usePolicy, useTags, useUsers } from '../api/meta.ts'
import { useCurrentUser, useUserTimezone } from '../auth/session-context.ts'
import { CardBadges } from '../board/CardBadges.tsx'
import { canPerformAction } from '../board/move-options.ts'
import { formatTicketNumber, todayInTimezone, utcToday } from '../lib/format.ts'
import { CloseIcon } from '../shell/icons.tsx'
import { useCardPanelSlot } from '../shell/card-panel-slot.ts'
import { ErrorAlert } from '../shell/ErrorAlert.tsx'
import { HintButton } from '../shell/HintButton.tsx'
import { strings } from '../strings.ts'
import {
  BLOCKED_COLOR,
  CANCELLED_COLOR,
  EMPHASIS_FONT_WEIGHT,
  PRIORITY_COLORS,
  WAITING_COLOR,
} from '../theme.ts'
import { isOverdueResume } from '@rivian-kanban/core'
import { AttachmentsSection } from './AttachmentsSection.tsx'
import { CardDetailsForm } from './CardDetailsForm.tsx'
import { CardStateSelect } from './CardStateSelect.tsx'
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
            >
              {strings.priorities[card.priority]}
            </Badge>
          )}
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

function CardPanelBody({ cardId }: { cardId: string }) {
  const me = useCurrentUser()
  const detailQuery = useCardDetail(cardId)
  const commentsQuery = useComments(cardId)
  const eventsQuery = useCardEvents(cardId)
  const usersQuery = useUsers()
  const locationsQuery = useLocations()
  const tagsQuery = useTags()
  const boardQuery = useBoard()
  const policyQuery = usePolicy()

  const updateCard = useUpdateCard()
  const cardAction = useCardAction()
  const addComment = useAddComment(cardId)
  const editComment = useEditComment(cardId)
  const deleteComment = useDeleteComment(cardId)
  const uploadAttachment = useUploadAttachment(cardId)
  const deleteAttachment = useDeleteAttachment(cardId)

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
  const events = (eventsQuery.data?.pages ?? []).flatMap((page) => page.items)
  const policy = policyQuery.data
  // Policy affordances (ADR-013): under-afford until the policy arrives.
  const canDeleteOthersComments =
    policy !== undefined && canPerformAction(policy, me.role, 'deleteOthersComments')
  const canDeleteOthersAttachments =
    policy !== undefined && canPerformAction(policy, me.role, 'deleteOthersAttachments')
  const canReopen = policy !== undefined && canPerformAction(policy, me.role, 'reopen')
  const canUnblock = detail.card.blocked
  // Archived cards are read-only except reopen (workflow.md#terminal-states).
  const archived = detail.card.archivedAt !== null

  return (
    <Stack gap="md">
      <StateBanner
        card={detail.card}
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
      {/* Change the card's lane from the panel (not only by dragging on the
          board); archived cards are read-only until reopened. */}
      <CardStateSelect
        card={detail.card}
        board={boardQuery.data}
        policy={policy}
        role={me.role}
        disabled={archived}
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
      <Tabs defaultValue="details" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="details">{strings.detail.tabDetails}</Tabs.Tab>
          <Tabs.Tab value="comments">{strings.detail.tabComments}</Tabs.Tab>
          <Tabs.Tab value="history">{strings.detail.tabHistory}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="details" pt="md">
          <Stack gap="xl">
            <CardDetailsForm
              detail={detail}
              locations={locationsQuery.data ?? []}
              knownTags={(tagsQuery.data ?? []).map((tag) => tag.name)}
              saving={updateCard.isPending}
              disabled={archived}
              onSave={(changes) => {
                updateCard.mutate({ card: detail.card, changes })
              }}
            />
            {/* The edit block above (fields → Created/Updated → Save) is one
                unit; the divider sets Attachments apart as its own section. */}
            <Divider />
            <AttachmentsSection
              attachments={detail.attachments}
              currentUserId={me.id}
              canDeleteOthers={canDeleteOthersAttachments}
              uploading={uploadAttachment.isPending}
              deletingId={deleteAttachment.isPending ? deleteAttachment.variables : null}
              readOnly={archived}
              onUpload={(file) => {
                uploadAttachment.mutate(file)
              }}
              onDelete={(attachmentId) => {
                deleteAttachment.mutate(attachmentId)
              }}
            />
          </Stack>
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
            onAdd={(body, parentCommentId, onPosted) => {
              addComment.mutate(
                {
                  body,
                  ...(parentCommentId === null ? {} : { parentCommentId }),
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
  canReopen,
  canUnblock,
  acting,
  savingWaiting,
  onReopen,
  onUnblock,
  onSaveWaiting,
}: {
  card: Card
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
  return null
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

  return (
    <Alert color={WAITING_COLOR} title={strings.detail.waitingBannerTitle}>
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
            color={WAITING_COLOR}
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

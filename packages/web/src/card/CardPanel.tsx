import { Button, Drawer, Group, Loader, Stack, Tabs, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useNavigate, useParams } from 'react-router'
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
import { useCurrentUser } from '../auth/session-context.ts'
import { CardBadges } from '../board/CardBadges.tsx'
import { canPerformAction } from '../board/move-options.ts'
import { utcToday } from '../lib/format.ts'
import { ErrorAlert } from '../shell/ErrorAlert.tsx'
import { strings } from '../strings.ts'
import { AttachmentsSection } from './AttachmentsSection.tsx'
import { CardDetailsForm } from './CardDetailsForm.tsx'
import { CommentsThread } from './CommentsThread.tsx'
import { HistoryList } from './HistoryList.tsx'

/**
 * The card detail panel: a right-side drawer (full-screen on small viewports)
 * deep-linked at /cards/:id. Fields, attachments, comments, history.
 */
export function CardPanel() {
  const { cardId = '' } = useParams()
  const navigate = useNavigate()
  const smallViewport = useMediaQuery('(max-width: 62em)')

  const close = () => {
    void navigate('/')
  }

  return (
    <Drawer
      opened
      onClose={close}
      position="right"
      size={smallViewport ? '100%' : 'lg'}
      title={strings.detail.panelLabel}
    >
      <CardPanelBody cardId={cardId} />
    </Drawer>
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
    return (
      <Group justify="center" p="xl" aria-label={strings.common.loading} aria-busy>
        <Loader />
      </Group>
    )
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
  // Archived cards are read-only except reopen (workflow.md#terminal-states).
  const archived = detail.card.archivedAt !== null

  return (
    <Stack gap="md">
      <CardBadges card={detail.card} today={utcToday()} />
      {archived ? (
        <Group justify="space-between" gap="sm">
          <Text size="sm" c="dimmed">
            {strings.detail.archivedNotice}
          </Text>
          <Button
            size="xs"
            variant="light"
            disabled={!canReopen}
            loading={cardAction.isPending}
            onClick={() => {
              cardAction.mutate({ card: detail.card, action: 'reopen' })
            }}
          >
            {strings.card.reopen}
          </Button>
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
              users={users}
              locations={locationsQuery.data ?? []}
              knownTags={(tagsQuery.data ?? []).map((tag) => tag.name)}
              saving={updateCard.isPending}
              disabled={archived}
              onSave={(changes) => {
                updateCard.mutate({ card: detail.card, changes })
              }}
            />
            <AttachmentsSection
              attachments={detail.attachments}
              currentUserId={me.id}
              canDeleteOthers={canDeleteOthersAttachments}
              uploading={uploadAttachment.isPending}
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
            onAdd={(body, parentCommentId, onPosted) => {
              addComment.mutate(
                {
                  body,
                  ...(parentCommentId === null ? {} : { parentCommentId }),
                },
                { onSuccess: onPosted },
              )
            }}
            onEdit={(commentId, body) => {
              editComment.mutate({ commentId, input: { body } })
            }}
            onDelete={(commentId) => {
              deleteComment.mutate(commentId)
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

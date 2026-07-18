import { type Comment } from '@rivian-kanban/core'
import { Group, Paper, Stack, Text, Textarea } from '@mantine/core'
import { Pencil, Reply, Save, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useUserTimezone } from '../auth/session-context.ts'
import { buildCommentThread } from '../lib/comments.ts'
import { formatDateTime } from '../lib/format.ts'
import { ConfirmModal } from '../shell/ConfirmModal.tsx'
import { HintButton } from '../shell/HintButton.tsx'
import { strings } from '../strings.ts'
import { EMPHASIS_FONT_WEIGHT } from '../theme.ts'
import classes from './card.module.css'

export interface CommentsThreadProps {
  comments: Comment[]
  currentUserId: string
  userNames: Map<string, string>
  /** Policy affordance: the `deleteOthersComments` gate (ADR-013). */
  canDeleteOthers: boolean
  /** Archived cards are read-only except reopen (workflow.md#terminal-states). */
  readOnly?: boolean
  /** `onPosted` fires on success so the composer keeps its draft on failure. */
  onAdd: (body: string, parentCommentId: string | null, onPosted: () => void) => void
  onEdit: (commentId: string, body: string) => void
  onDelete: (commentId: string) => void
}

/** Threaded discussion: one nesting level, edit-own, soft-delete placeholders. */
export function CommentsThread({
  comments,
  currentUserId,
  userNames,
  canDeleteOthers,
  readOnly = false,
  onAdd,
  onEdit,
  onDelete,
}: CommentsThreadProps) {
  const thread = buildCommentThread(comments)
  const [replyTo, setReplyTo] = useState<string | null>(null)
  // Deleting a comment is irreversible to the author, so confirm first.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  return (
    <Stack gap="md">
      {confirmDeleteId !== null ? (
        <ConfirmModal
          title={strings.comments.deleteConfirmTitle}
          body={strings.comments.deleteConfirmBody}
          confirmLabel={strings.comments.deleteConfirm}
          onConfirm={() => {
            onDelete(confirmDeleteId)
            setConfirmDeleteId(null)
          }}
          onClose={() => {
            setConfirmDeleteId(null)
          }}
        />
      ) : null}
      {thread.length === 0 ? (
        <Text size="sm" c="dimmed">
          {strings.comments.empty}
        </Text>
      ) : (
        thread.map(({ comment, replies }) => (
          <Stack key={comment.id} gap="xs">
            <CommentItem
              comment={comment}
              currentUserId={currentUserId}
              userNames={userNames}
              canDeleteOthers={canDeleteOthers}
              readOnly={readOnly}
              onEdit={onEdit}
              onDelete={setConfirmDeleteId}
              onReply={() => {
                setReplyTo(comment.id)
              }}
            />
            <Stack gap="xs" pl="xl">
              {replies.map((reply) => (
                <CommentItem
                  key={reply.id}
                  comment={reply}
                  currentUserId={currentUserId}
                  userNames={userNames}
                  canDeleteOthers={canDeleteOthers}
                  readOnly={readOnly}
                  onEdit={onEdit}
                  onDelete={setConfirmDeleteId}
                  onReply={() => {
                    setReplyTo(comment.id)
                  }}
                />
              ))}
              {replyTo === comment.id ? (
                <Composer
                  label={strings.comments.replyComposerLabel}
                  submitLabel={strings.comments.postReplyButton}
                  submitHint={strings.tooltips.postReply}
                  onSubmit={(body, onPosted) => {
                    onAdd(body, comment.id, () => {
                      onPosted()
                      setReplyTo(null)
                    })
                  }}
                />
              ) : null}
            </Stack>
          </Stack>
        ))
      )}
      {readOnly ? null : (
        <Composer
          label={strings.comments.composerLabel}
          submitLabel={strings.comments.postButton}
          submitHint={strings.tooltips.comment}
          onSubmit={(body, onPosted) => {
            onAdd(body, null, onPosted)
          }}
        />
      )}
    </Stack>
  )
}

interface CommentItemProps {
  comment: Comment
  currentUserId: string
  userNames: Map<string, string>
  canDeleteOthers: boolean
  readOnly: boolean
  onEdit: (commentId: string, body: string) => void
  onDelete: (commentId: string) => void
  onReply: () => void
}

function CommentItem({
  comment,
  currentUserId,
  userNames,
  canDeleteOthers,
  readOnly,
  onEdit,
  onDelete,
  onReply,
}: CommentItemProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const timezone = useUserTimezone()
  const deleted = comment.deletedAt !== null
  // Editing is identity, not policy (ADR-013); deleting others' is gated.
  const own = comment.authorId === currentUserId
  const canDelete = own || canDeleteOthers

  const authorName = userNames.get(comment.authorId) ?? strings.history.unknownUser
  return (
    <Paper
      withBorder
      p="sm"
      radius="md"
      component="article"
      aria-label={strings.comments.itemLabel(authorName)}
    >
      <Group gap="xs">
        <Text size="sm" fw={EMPHASIS_FONT_WEIGHT}>
          {authorName}
        </Text>
        <Text size="xs" c="dimmed">
          {formatDateTime(comment.createdAt, timezone)}
        </Text>
      </Group>
      {deleted ? (
        <Text size="sm" c="dimmed" fs="italic">
          {strings.comments.deletedPlaceholder}
        </Text>
      ) : editing ? (
        <Stack gap="xs" mt="xs">
          <Textarea
            aria-label={strings.comments.editLabel}
            autosize
            minRows={2}
            value={draft}
            onChange={(event) => {
              setDraft(event.currentTarget.value)
            }}
          />
          <Group gap="xs">
            <HintButton
              size="xs"
              tooltip={strings.tooltips.saveCommentEdit}
              leftSection={<Save size={14} aria-hidden />}
              onClick={() => {
                if (draft.trim() === '') return
                onEdit(comment.id, draft.trim())
                setEditing(false)
              }}
            >
              {strings.comments.saveEdit}
            </HintButton>
            <HintButton
              size="xs"
              variant="default"
              tooltip={strings.tooltips.cancelDialog}
              leftSection={<X size={14} aria-hidden />}
              onClick={() => {
                setEditing(false)
                setDraft(comment.body)
              }}
            >
              {strings.common.cancel}
            </HintButton>
          </Group>
        </Stack>
      ) : (
        <Text size="sm" mt="xs" className={classes.commentBody}>
          {comment.body}
        </Text>
      )}
      {!deleted && !editing && !readOnly ? (
        <Group gap="xs" mt="xs">
          <HintButton
            size="compact-xs"
            variant="subtle"
            tooltip={strings.tooltips.replyComment}
            leftSection={<Reply size={14} aria-hidden />}
            onClick={onReply}
          >
            {strings.common.reply}
          </HintButton>
          {own ? (
            <HintButton
              size="compact-xs"
              variant="subtle"
              tooltip={strings.tooltips.editComment}
              leftSection={<Pencil size={14} aria-hidden />}
              // Short visible label; the accessible name stays 'Edit comment'.
              aria-label={strings.comments.editLabel}
              onClick={() => {
                setEditing(true)
              }}
            >
              {strings.common.edit}
            </HintButton>
          ) : null}
          {canDelete ? (
            <HintButton
              size="compact-xs"
              variant="subtle"
              tooltip={strings.tooltips.deleteComment}
              leftSection={<Trash2 size={14} aria-hidden />}
              // Muted, not alarming red; accessible name stays 'Delete comment'.
              color="gray"
              c="dimmed"
              aria-label={strings.comments.deleteLabel}
              onClick={() => {
                onDelete(comment.id)
              }}
            >
              {strings.common.delete}
            </HintButton>
          ) : null}
        </Group>
      ) : null}
    </Paper>
  )
}

function Composer({
  label,
  submitLabel,
  submitHint,
  onSubmit,
}: {
  label: string
  /** Distinct per composer ('Comment' vs 'Post reply') so the two submit
   * buttons are never ambiguous to assistive tech or role-based tests. */
  submitLabel: string
  /** Always-on hint for the submit button, distinct per composer. */
  submitHint: string
  onSubmit: (body: string, onPosted: () => void) => void
}) {
  const [body, setBody] = useState('')
  return (
    <Stack gap="xs">
      <Textarea
        aria-label={label}
        placeholder={strings.comments.composerPlaceholder}
        autosize
        minRows={2}
        value={body}
        onChange={(event) => {
          setBody(event.currentTarget.value)
        }}
      />
      <Group justify="flex-end">
        <HintButton
          size="xs"
          tooltip={submitHint}
          disabledReason={body.trim() === '' ? strings.tooltips.disabledEmptyComment : undefined}
          onClick={() => {
            // Cleared only once the POST succeeds — a failure keeps the draft.
            onSubmit(body.trim(), () => {
              setBody('')
            })
          }}
        >
          {submitLabel}
        </HintButton>
      </Group>
    </Stack>
  )
}

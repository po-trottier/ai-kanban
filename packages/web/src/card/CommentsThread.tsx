import { type Comment } from '@rivian-kanban/core'
import { Button, Group, Paper, Stack, Text, Textarea } from '@mantine/core'
import { useState } from 'react'
import { buildCommentThread } from '../lib/comments.ts'
import { formatDateTime } from '../lib/format.ts'
import { ConfirmModal } from '../shell/ConfirmModal.tsx'
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
          {formatDateTime(comment.createdAt)}
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
            <Button
              size="xs"
              onClick={() => {
                if (draft.trim() === '') return
                onEdit(comment.id, draft.trim())
                setEditing(false)
              }}
            >
              {strings.comments.saveEdit}
            </Button>
            <Button
              size="xs"
              variant="default"
              onClick={() => {
                setEditing(false)
                setDraft(comment.body)
              }}
            >
              {strings.common.cancel}
            </Button>
          </Group>
        </Stack>
      ) : (
        <Text size="sm" mt="xs" className={classes.commentBody}>
          {comment.body}
        </Text>
      )}
      {!deleted && !editing && !readOnly ? (
        <Group gap="xs" mt="xs">
          <Button size="compact-xs" variant="subtle" onClick={onReply}>
            {strings.common.reply}
          </Button>
          {own ? (
            <Button
              size="compact-xs"
              variant="subtle"
              // Short visible label; the accessible name stays 'Edit comment'.
              aria-label={strings.comments.editLabel}
              onClick={() => {
                setEditing(true)
              }}
            >
              {strings.common.edit}
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              size="compact-xs"
              variant="subtle"
              // Muted, not alarming red; accessible name stays 'Delete comment'.
              color="gray"
              c="dimmed"
              aria-label={strings.comments.deleteLabel}
              onClick={() => {
                onDelete(comment.id)
              }}
            >
              {strings.common.delete}
            </Button>
          ) : null}
        </Group>
      ) : null}
    </Paper>
  )
}

function Composer({
  label,
  submitLabel,
  onSubmit,
}: {
  label: string
  /** Distinct per composer ('Comment' vs 'Post reply') so the two submit
   * buttons are never ambiguous to assistive tech or role-based tests. */
  submitLabel: string
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
        <Button
          size="xs"
          disabled={body.trim() === ''}
          onClick={() => {
            // Cleared only once the POST succeeds — a failure keeps the draft.
            onSubmit(body.trim(), () => {
              setBody('')
            })
          }}
        >
          {submitLabel}
        </Button>
      </Group>
    </Stack>
  )
}

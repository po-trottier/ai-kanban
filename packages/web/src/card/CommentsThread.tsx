import { type Comment } from '@rivian-kanban/core'
import { Group, Paper, Stack, Text, Textarea } from '@mantine/core'
import { Pencil, Reply, Save, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
  /** True while an add/reply POST is in flight — spins the active composer. */
  addPending?: boolean
  /** True while an edit PATCH is in flight — spins the open editor's Save. */
  editPending?: boolean
  /** True while a delete is in flight — spins the confirm dialog's button. */
  deletePending?: boolean
  /** `onPosted` fires on success so the composer keeps its draft on failure. */
  onAdd: (body: string, parentCommentId: string | null, onPosted: () => void) => void
  /** `onEdited` fires on success so the editor closes (and keeps the draft) only then. */
  onEdit: (commentId: string, body: string, onEdited: () => void) => void
  /** `onDeleted` fires on success so the confirm dialog closes only then. */
  onDelete: (commentId: string, onDeleted: () => void) => void
}

/** Threaded discussion: one nesting level, edit-own, soft-delete placeholders. */
export function CommentsThread({
  comments,
  currentUserId,
  userNames,
  canDeleteOthers,
  readOnly = false,
  addPending = false,
  editPending = false,
  deletePending = false,
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
          loading={deletePending}
          onConfirm={() => {
            // Stay open (with a spinning confirm) until the delete settles, so
            // a slow round-trip can't be re-clicked and errors keep the dialog.
            onDelete(confirmDeleteId, () => {
              setConfirmDeleteId(null)
            })
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
              editPending={editPending}
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
                  editPending={editPending}
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
                  pending={addPending}
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
          pending={addPending}
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
  /** True while an edit PATCH is in flight — spins this Save if it submitted. */
  editPending: boolean
  onEdit: (commentId: string, body: string, onEdited: () => void) => void
  onDelete: (commentId: string) => void
  onReply: () => void
}

function CommentItem({
  comment,
  currentUserId,
  userNames,
  canDeleteOthers,
  readOnly,
  editPending,
  onEdit,
  onDelete,
  onReply,
}: CommentItemProps) {
  const [editing, setEditing] = useState(false)
  // Tracks that THIS item's Save was clicked, so a shared editPending spins
  // only the submitting editor — never another comment's open editor.
  const [submitted, setSubmitted] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const timezone = useUserTimezone()

  // A shared editPending spins the Save only while THIS editor is the one
  // submitting. Clear the flag on the pending true→false edge (the request
  // settled) — not on a bare `!editPending`, which would fire in the same
  // commit as the click (before the parent's isPending has propagated) and
  // cancel the spinner immediately. Success closes via onEdited; a failed Save
  // just stops spinning without losing the draft.
  const wasEditPending = useRef(editPending)
  useEffect(() => {
    if (wasEditPending.current && !editPending) setSubmitted(false)
    wasEditPending.current = editPending
  }, [editPending])

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
              loading={submitted && editPending}
              onClick={() => {
                if (draft.trim() === '') return
                // Stay open with a spinning Save; close only once the PATCH
                // succeeds (onEdited), so a failed edit keeps the draft.
                setSubmitted(true)
                onEdit(comment.id, draft.trim(), () => {
                  setEditing(false)
                })
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
  pending,
  onSubmit,
}: {
  label: string
  /** Distinct per composer ('Comment' vs 'Post reply') so the two submit
   * buttons are never ambiguous to assistive tech or role-based tests. */
  submitLabel: string
  /** Always-on hint for the submit button, distinct per composer. */
  submitHint: string
  /** True while any add/reply POST is in flight (the hook is shared). */
  pending: boolean
  onSubmit: (body: string, onPosted: () => void) => void
}) {
  const [body, setBody] = useState('')
  // The add hook is shared by the top-level and reply composers, so `pending`
  // is global; `submitted` scopes the spinner to the composer that fired.
  // Clear it on the pending true→false edge (the request settled), not on a
  // bare `!pending` — that fires in the same commit as the click, before the
  // parent's isPending has propagated, and would cancel the spinner at once.
  const [submitted, setSubmitted] = useState(false)
  const wasPending = useRef(pending)
  useEffect(() => {
    if (wasPending.current && !pending) setSubmitted(false)
    wasPending.current = pending
  }, [pending])
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
          loading={submitted && pending}
          onClick={() => {
            setSubmitted(true)
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

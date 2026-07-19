import { type Comment } from '@rivian-kanban/core'
import { Anchor, Group, Paper, Stack, Text, Textarea } from '@mantine/core'
import { CornerUpLeft, Pencil, Reply, Save, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useUserTimezone } from '../auth/session-context.ts'
import { buildCommentThread } from '../lib/comments.ts'
import { formatDateTime } from '../lib/format.ts'
import { ConfirmModal } from '../shell/ConfirmModal.tsx'
import { HintButton } from '../shell/HintButton.tsx'
import { strings } from '../strings.ts'
import { EMPHASIS_FONT_WEIGHT } from '../theme.ts'
import { MentionTextarea } from './MentionTextarea.tsx'
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
  onAdd: (
    body: string,
    parentCommentId: string | null,
    mentions: string[],
    onPosted: () => void,
  ) => void
  /** `onEdited` fires on success so the editor closes (and keeps the draft) only then. */
  onEdit: (commentId: string, body: string, onEdited: () => void) => void
  /** `onDeleted` fires on success so the confirm dialog closes only then. */
  onDelete: (commentId: string, onDeleted: () => void) => void
}

/** A comment's DOM id, so a reply can jump to its parent by id (no per-item ref). */
function commentDomId(id: string): string {
  return `comment-${id}`
}

/** How long the parent stays flashed after a reply's "Replied to…" jump. */
const HIGHLIGHT_MS = 1500

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
  // A reply's "Replied to…" jumps to its parent and briefly flashes it.
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  // Resolve a reply's parent (author name + deleted/absent state) by id.
  const byId = new Map(comments.map((comment) => [comment.id, comment]))

  // Clear the flash after a beat. One shared timer, cleared on the next jump and
  // on unmount so it never fires into a torn-down component (the notify-timer
  // lesson: no live setTimeout past teardown).
  const highlightTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    return () => {
      clearTimeout(highlightTimer.current)
    }
  }, [])
  const jumpToParent = (parentId: string) => {
    document
      .getElementById(commentDomId(parentId))
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedId(parentId)
    clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => {
      setHighlightedId(null)
    }, HIGHLIGHT_MS)
  }

  return (
    // A bounded flex column: the LIST scrolls, the top-level composer below it
    // stays pinned, so composing is reachable no matter how many comments load.
    <div className={classes.commentsArea}>
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
      <Stack gap="md" className={classes.commentsList} data-testid="comments-list">
        {thread.length === 0 ? (
          <Text size="sm" c="dimmed">
            {strings.comments.empty}
          </Text>
        ) : (
          thread.map(({ comment, replies }) => (
            <Stack key={comment.id} gap="xs">
              <CommentItem
                comment={comment}
                byId={byId}
                highlighted={highlightedId === comment.id}
                onJumpToParent={jumpToParent}
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
                    byId={byId}
                    highlighted={highlightedId === reply.id}
                    onJumpToParent={jumpToParent}
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
                    onSubmit={(body, mentions, onPosted) => {
                      onAdd(body, comment.id, mentions, () => {
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
      </Stack>
      {readOnly ? null : (
        <div className={classes.commentsComposer} data-testid="comments-composer">
          <Composer
            label={strings.comments.composerLabel}
            submitLabel={strings.comments.postButton}
            submitHint={strings.tooltips.comment}
            pending={addPending}
            onSubmit={(body, mentions, onPosted) => {
              onAdd(body, null, mentions, onPosted)
            }}
          />
        </div>
      )}
    </div>
  )
}

interface CommentItemProps {
  comment: Comment
  /** All loaded comments by id, to resolve a reply's parent author/state. */
  byId: Map<string, Comment>
  /** True while this comment is the flash target of a "Replied to…" jump. */
  highlighted: boolean
  onJumpToParent: (parentId: string) => void
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
  byId,
  highlighted,
  onJumpToParent,
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
  // An edit bumps updatedAt past createdAt (comment-service). Soft-delete bumps
  // it too, so gate on `!deleted` — the deleted placeholder never shows it.
  const edited = !deleted && comment.updatedAt !== comment.createdAt
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
      id={commentDomId(comment.id)}
      className={highlighted ? classes.commentHighlight : undefined}
      aria-label={strings.comments.itemLabel(authorName)}
    >
      <Group gap="xs">
        <Text size="sm" fw={EMPHASIS_FONT_WEIGHT}>
          {authorName}
        </Text>
        <Text size="xs" c="dimmed">
          {formatDateTime(comment.createdAt, timezone)}
        </Text>
        {edited ? (
          <Text size="xs" c="dimmed" fs="italic">
            {strings.comments.editedBadge}
          </Text>
        ) : null}
      </Group>
      {comment.parentCommentId !== null ? (
        <ReplyContext
          parentId={comment.parentCommentId}
          byId={byId}
          userNames={userNames}
          onJumpToParent={onJumpToParent}
        />
      ) : null}
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

/**
 * A reply's "Replied to {name}" context. Resolves the parent from the loaded
 * page: present → jump to it; soft-deleted → still jump (the placeholder is
 * on-screen); absent from this page → a graceful, non-interactive label (there
 * is nothing to scroll to).
 */
function ReplyContext({
  parentId,
  byId,
  userNames,
  onJumpToParent,
}: {
  parentId: string
  byId: Map<string, Comment>
  userNames: Map<string, string>
  onJumpToParent: (parentId: string) => void
}) {
  const parent = byId.get(parentId)
  const icon = <CornerUpLeft size={12} aria-hidden />
  // Not in this page — can't scroll, so a plain label, not a button.
  if (parent === undefined) {
    return (
      <Text size="xs" c="dimmed" mt={4}>
        {icon} {strings.comments.repliedToEarlier}
      </Text>
    )
  }
  const authorName = userNames.get(parent.authorId) ?? strings.history.unknownUser
  const deleted = parent.deletedAt !== null
  return (
    <Anchor
      component="button"
      type="button"
      size="xs"
      c="dimmed"
      mt={4}
      aria-label={strings.comments.repliedToLabel(authorName)}
      onClick={() => {
        onJumpToParent(parentId)
      }}
    >
      {icon} {deleted ? strings.comments.repliedToDeleted : strings.comments.repliedTo(authorName)}
    </Anchor>
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
  onSubmit: (body: string, mentions: string[], onPosted: () => void) => void
}) {
  const [body, setBody] = useState('')
  // Ids @-mentioned via the autocomplete → display name, so we only send an id
  // whose `@Name` text still survives in the body at submit time.
  const [mentions, setMentions] = useState<Map<string, string>>(new Map())
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
      <MentionTextarea
        aria-label={label}
        placeholder={strings.comments.composerPlaceholder}
        autosize
        minRows={2}
        value={body}
        onChange={setBody}
        onMention={(user) => {
          setMentions((current) => new Map(current).set(user.id, user.displayName))
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
            // Only send a mention whose `@Name` text still survives the edits.
            const ids = [...mentions]
              .filter(([, name]) => body.includes(`@${name}`))
              .map(([id]) => id)
            // Cleared only once the POST succeeds — a failure keeps the draft.
            onSubmit(body.trim(), ids, () => {
              setBody('')
              setMentions(new Map())
            })
          }}
        >
          {submitLabel}
        </HintButton>
      </Group>
    </Stack>
  )
}

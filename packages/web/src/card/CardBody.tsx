import { Divider, Skeleton, Stack } from '@mantine/core'
import { useBoard, useUpdateCard } from '../api/board.ts'
import { useCardDetail, useDeleteAttachment, useUploadAttachment } from '../api/card.ts'
import { useLocations, usePolicy, useTags } from '../api/meta.ts'
import { useCurrentUser } from '../auth/session-context.ts'
import { canPerformAction } from '../board/move-options.ts'
import { ErrorAlert } from '../shell/ErrorAlert.tsx'
import { strings } from '../strings.ts'
import { AttachmentsSection } from './AttachmentsSection.tsx'
import { CardDetailsForm } from './CardDetailsForm.tsx'
import { CardStateSelect } from './CardStateSelect.tsx'
import { RelationsSection } from './RelationsSection.tsx'

/**
 * The shared card body: the **State** dropdown, the editable fields, then
 * Relations and Attachments. Rendered identically by the detail panel's Details
 * tab (edit view) and the New Card modal (`createMode`), so creating and editing
 * a card are ONE code path. It fetches its own detail so either surface just
 * hands it a `cardId`; State / relations / attachments already mutate
 * immediately against that id, so only the fields' footer differs — the edit
 * panel's Save changes vs. the modal's Cancel / Create.
 */
export function CardBody({
  cardId,
  createMode = false,
  onCancel,
  onCreated,
  cancelPending,
}: {
  cardId: string
  createMode?: boolean
  /** Create modal: discard the draft + close (Cancel / ✕ / Escape). */
  onCancel?: (() => void) | undefined
  /** Create modal: close once the fields are saved (Create). */
  onCreated?: (() => void) | undefined
  /** Create modal: whether the discard is in flight (spins Cancel). */
  cancelPending?: boolean | undefined
}) {
  const me = useCurrentUser()
  const detailQuery = useCardDetail(cardId)
  const locationsQuery = useLocations()
  const tagsQuery = useTags()
  const boardQuery = useBoard()
  const policyQuery = usePolicy()
  const updateCard = useUpdateCard()
  const uploadAttachment = useUploadAttachment(cardId)
  const deleteAttachment = useDeleteAttachment(cardId)

  // The modal opens on a just-created draft whose detail may still be loading;
  // inside the panel the detail is already cached, so this never flashes there.
  if (detailQuery.isPending) {
    return (
      <Stack gap="md" role="status" aria-label={strings.common.loading} aria-busy>
        <Skeleton height="2.25rem" radius="sm" />
        <Skeleton height="6rem" radius="sm" />
        <Skeleton height="2.25rem" radius="sm" />
      </Stack>
    )
  }
  if (detailQuery.data === undefined) {
    return <ErrorAlert error={detailQuery.error} fallbackMessage={strings.detail.loadFailed} />
  }

  const detail = detailQuery.data
  const policy = policyQuery.data
  // Archived cards are read-only except reopen (workflow.md#terminal-states).
  const archived = detail.card.archivedAt !== null
  // Policy affordances (ADR-013): under-afford until the policy arrives.
  const canDeleteOthersAttachments =
    policy !== undefined && canPerformAction(policy, me.role, 'deleteOthersAttachments')

  return (
    <Stack gap="md">
      {/* The state dropdown sits at the top of the body (near the fields) in the
          edit panel; archived cards are read-only until reopened. The create
          modal HIDES it — a brand-new card is always in Intake, so picking a
          state before it exists as real work is noise. It reuses the same status
          color the board card badges show. */}
      {createMode ? null : (
        <CardStateSelect
          card={detail.card}
          board={boardQuery.data}
          policy={policy}
          role={me.role}
          disabled={archived}
        />
      )}
      <CardDetailsForm
        detail={detail}
        locations={locationsQuery.data ?? []}
        knownTags={(tagsQuery.data ?? []).map((tag) => tag.name)}
        saving={updateCard.isPending}
        disabled={archived}
        createMode={createMode}
        onCancel={onCancel}
        cancelPending={cancelPending}
        onSave={(changes) => {
          // Edit panel: plain save. Create modal: Create commits the edited
          // fields then closes (via the mutation's onSuccess); if nothing was
          // edited (kept the placeholder), just close. silent avoids a "Card
          // updated" toast on top of the "created" one.
          if (createMode) {
            if (Object.keys(changes).length === 0) {
              onCreated?.()
              return
            }
            updateCard.mutate(
              { card: detail.card, changes, silent: true },
              { onSuccess: () => onCreated?.() },
            )
          } else {
            updateCard.mutate({ card: detail.card, changes })
          }
        }}
      >
        {/* Relations then Attachments sit between the fields and the timestamps;
            the Save button (edit view) stays sticky below everything. */}
        <Divider />
        {/* Typed links to other cards (blocks / duplicates / relates to) —
            shown only here, never on board card previews. */}
        <RelationsSection cardId={cardId} readOnly={archived} />
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
      </CardDetailsForm>
    </Stack>
  )
}

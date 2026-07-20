import { type CreateCardInput, type CreateCardRelationInput } from '@rivian-kanban/core'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useApi } from '../api/api-context.ts'
import { useCreateCard } from '../api/board.ts'
import { useUploadNewCardAttachment } from '../api/card.ts'
import { useLocations, useTags } from '../api/meta.ts'
import { notifyError } from '../api/notify.ts'
import { cardRelationResponseSchema } from '../api/schemas.ts'
import { CreateCardModal } from '../card/CreateCardModal.tsx'
import { HintButton } from './HintButton.tsx'
import { strings } from '../strings.ts'

/**
 * "New work order" button + its create-on-submit form modal (nothing exists on
 * the board until Create). Create runs in phases: POST the fields, then apply
 * the staged relations + attachments to the freshly created work order — a
 * failed relation/file is reported but never blocks the others or the created
 * work order. Cancel / ✕ / Escape close with nothing to undo.
 */
export function NewCardButton() {
  const api = useApi()
  const [open, setOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  const locations = useLocations()
  const tags = useTags()
  const createCard = useCreateCard()
  const uploadAttachment = useUploadNewCardAttachment()

  const handleSubmit = (
    input: CreateCardInput,
    relations: CreateCardRelationInput[],
    files: File[],
  ) => {
    createCard.mutate(input, {
      onSuccess: (card) => {
        if (relations.length === 0 && files.length === 0) {
          setOpen(false)
          return
        }
        setApplying(true)
        void (async () => {
          for (const relation of relations) {
            try {
              await api.post(`/cards/${String(card.id)}/relations`, cardRelationResponseSchema, {
                body: relation,
              })
            } catch (error) {
              notifyError(error)
            }
          }
          for (const file of files) {
            try {
              await uploadAttachment.mutateAsync({ cardId: card.id, file })
            } catch (error) {
              notifyError(error)
            }
          }
          setApplying(false)
          setOpen(false)
        })()
      },
    })
  }

  return (
    <>
      <HintButton
        size="sm"
        tooltip={strings.tooltips.newCard}
        leftSection={<Plus size={16} aria-hidden />}
        onClick={() => {
          setOpen(true)
        }}
      >
        {strings.board.newCard}
      </HintButton>
      {open ? (
        <CreateCardModal
          locations={locations.data ?? []}
          knownTags={(tags.data ?? []).map((tag) => tag.name)}
          submitting={createCard.isPending || applying}
          onClose={() => {
            setOpen(false)
          }}
          onSubmit={handleSubmit}
        />
      ) : null}
    </>
  )
}

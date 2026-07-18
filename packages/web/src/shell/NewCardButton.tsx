import { type CreateCardInput } from '@rivian-kanban/core'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useCreateCard } from '../api/board.ts'
import { useUploadNewCardAttachment } from '../api/card.ts'
import { useLocations, useTags, useUsers } from '../api/meta.ts'
import { notifyError } from '../api/notify.ts'
import { NewCardModal } from '../board/NewCardModal.tsx'
import { HintButton } from './HintButton.tsx'
import { strings } from '../strings.ts'

/** Header "New card" button + its modal (cards land in Intake). */
export function NewCardButton() {
  const [open, setOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const users = useUsers()
  const locations = useLocations()
  const tags = useTags()
  const createCard = useCreateCard()
  const uploadAttachment = useUploadNewCardAttachment()

  // Two phases: create the card, then upload each picked file to its new id.
  // A failed file is reported but never blocks the others or the created card.
  const handleSubmit = (input: CreateCardInput, files: File[]) => {
    createCard.mutate(input, {
      onSuccess: (card) => {
        if (files.length === 0) {
          setOpen(false)
          return
        }
        setUploading(true)
        void (async () => {
          for (const file of files) {
            try {
              await uploadAttachment.mutateAsync({ cardId: card.id, file })
            } catch (error) {
              notifyError(error)
            }
          }
          setUploading(false)
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
        <NewCardModal
          users={users.data ?? []}
          locations={locations.data ?? []}
          knownTags={(tags.data ?? []).map((tag) => tag.name)}
          submitting={createCard.isPending || uploading}
          onClose={() => {
            setOpen(false)
          }}
          onSubmit={handleSubmit}
        />
      ) : null}
    </>
  )
}

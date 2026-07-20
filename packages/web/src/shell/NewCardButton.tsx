import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useCreateCard } from '../api/board.ts'
import { CreateCardModal } from '../card/CreateCardModal.tsx'
import { HintButton } from './HintButton.tsx'
import { strings } from '../strings.ts'

/**
 * Header "New card" button. Create-then-edit (docs/architecture/frontend.md):
 * instead of a bespoke create form, it creates a real draft immediately (in
 * Intake, with a placeholder title since core requires a non-empty one) and
 * opens the SAME card body the detail panel uses inside a modal — no Save
 * button (fields auto-save), Discard to throw the draft away. One card-editing
 * code path for create and edit.
 */
export function NewCardButton() {
  const createCard = useCreateCard()
  const [draftId, setDraftId] = useState<string | null>(null)

  return (
    <>
      <HintButton
        size="sm"
        tooltip={strings.tooltips.newCard}
        leftSection={<Plus size={16} aria-hidden />}
        loading={createCard.isPending}
        onClick={() => {
          createCard.mutate(
            { title: strings.newCard.placeholderTitle, description: '', priority: 'P2', tags: [] },
            {
              onSuccess: (card) => {
                setDraftId(String(card.id))
              },
            },
          )
        }}
      >
        {strings.board.newCard}
      </HintButton>
      {draftId !== null ? (
        <CreateCardModal
          cardId={draftId}
          onClose={() => {
            setDraftId(null)
          }}
        />
      ) : null}
    </>
  )
}

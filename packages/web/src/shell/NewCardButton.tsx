import { Plus } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { useCreateCard } from '../api/board.ts'
import { HintButton } from './HintButton.tsx'
import { strings } from '../strings.ts'

/**
 * Header "New card" button. Create-then-edit (docs/architecture/frontend.md):
 * instead of a separate modal, it creates a real draft immediately (in Intake,
 * with a placeholder title since core requires a non-empty one) and opens the
 * REAL detail panel for it in "create view" — the same components, no Save
 * button and no Comments/History tabs, Discard to throw the draft away. This
 * keeps a single card-editing code path rather than a parallel create form.
 */
export function NewCardButton() {
  const navigate = useNavigate()
  const location = useLocation()
  const createCard = useCreateCard()

  return (
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
              // `state.created` puts the panel in create view; preserve the
              // filter query so closing restores the same filtered board.
              void navigate(
                { pathname: `/cards/${String(card.id)}`, search: location.search },
                { state: { created: true } },
              )
            },
          },
        )
      }}
    >
      {strings.board.newCard}
    </HintButton>
  )
}

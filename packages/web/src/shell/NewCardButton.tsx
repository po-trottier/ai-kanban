import { Button } from '@mantine/core'
import { useState } from 'react'
import { useCreateCard } from '../api/board.ts'
import { useLocations, useTags, useUsers } from '../api/meta.ts'
import { NewCardModal } from '../board/NewCardModal.tsx'
import { strings } from '../strings.ts'

/** Header "New card" button + its modal (cards land in Intake). */
export function NewCardButton() {
  const [open, setOpen] = useState(false)
  const users = useUsers()
  const locations = useLocations()
  const tags = useTags()
  const createCard = useCreateCard()

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          setOpen(true)
        }}
      >
        {strings.board.newCard}
      </Button>
      {open ? (
        <NewCardModal
          users={users.data ?? []}
          locations={locations.data ?? []}
          knownTags={(tags.data ?? []).map((tag) => tag.name)}
          submitting={createCard.isPending}
          onClose={() => {
            setOpen(false)
          }}
          onSubmit={(input) => {
            createCard.mutate(input, {
              onSuccess: () => {
                setOpen(false)
              },
            })
          }}
        />
      ) : null}
    </>
  )
}

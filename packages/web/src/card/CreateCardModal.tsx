import { Group, Modal } from '@mantine/core'
import { Plus } from 'lucide-react'
import { useDeleteCard } from '../api/board.ts'
import { useCardDetail } from '../api/card.ts'
import { HintButton } from '../shell/HintButton.tsx'
import { strings } from '../strings.ts'
import { CardBody } from './CardBody.tsx'
import { StickyFooter } from './StickyFooter.tsx'
import classes from './card.module.css'

/**
 * "New card" opens the SAME card body the detail panel uses — State, fields,
 * relations, attachments (`CardBody`) — but in a modal and in create view:
 * fields auto-save (the draft already exists), and a sticky **Cancel / Create**
 * footer (create primary, bottom-right) reads like a normal create dialog.
 *
 * Under the hood it is create-then-edit: **Create** simply keeps the already
 * auto-saved draft and closes; **Cancel** (and ✕ / Escape) hard-delete the
 * draft so a cancelled create leaves nothing behind. Outside-click is disabled
 * so a stray click never discards in-progress work.
 */
export function CreateCardModal({ cardId, onClose }: { cardId: string; onClose: () => void }) {
  const deleteCard = useDeleteCard()
  const detailQuery = useCardDetail(cardId)
  const card = detailQuery.data?.card

  // Cancel = discard the draft (its CURRENT version, so it matches after any
  // auto-save) then close; if the detail hasn't loaded yet nothing meaningful
  // was entered, so just close.
  const cancel = () => {
    if (card !== undefined) deleteCard.mutate(card, { onSuccess: onClose })
    else onClose()
  }

  return (
    <Modal
      opened
      onClose={cancel}
      closeOnClickOutside={false}
      title={strings.newCard.modalTitle}
      size="lg"
      centered
      classNames={{ body: classes.modalScrollBody }}
    >
      <CardBody cardId={cardId} autoSave />
      <StickyFooter>
        <Group justify="flex-end" gap="sm">
          <HintButton
            variant="default"
            tooltip={strings.tooltips.cancelDialog}
            loading={deleteCard.isPending}
            onClick={cancel}
          >
            {strings.common.cancel}
          </HintButton>
          <HintButton
            tooltip={strings.tooltips.createCard}
            leftSection={<Plus size={16} aria-hidden />}
            onClick={onClose}
          >
            {strings.common.create}
          </HintButton>
        </Group>
      </StickyFooter>
    </Modal>
  )
}

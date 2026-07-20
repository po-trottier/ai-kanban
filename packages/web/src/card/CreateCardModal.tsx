import { type Card } from '@rivian-kanban/core'
import { Modal } from '@mantine/core'
import { useDeleteCard } from '../api/board.ts'
import { useCardDetail } from '../api/card.ts'
import { strings } from '../strings.ts'
import { CardBody } from './CardBody.tsx'
import classes from './card.module.css'

/**
 * "New card" opens the SAME card body the detail panel uses — State (hidden
 * here), fields, relations, attachments (`CardBody`) — but in a modal and in
 * create view, with a bottom-right **Cancel / Create** footer (create primary)
 * that reads like a normal create dialog.
 *
 * Under the hood it is create-then-edit: **Create** submits the fields (they
 * save, then the modal closes); **Cancel** (and ✕ / Escape) hard-delete the
 * draft so a cancelled create leaves nothing behind. It takes the freshly
 * created `card` (not just an id) so Cancel can ALWAYS delete — even before the
 * detail has loaded — using its version. Outside-click is disabled so a stray
 * click never discards in-progress work.
 */
export function CreateCardModal({ card, onClose }: { card: Card; onClose: () => void }) {
  const cardId = String(card.id)
  const deleteCard = useDeleteCard()
  const detailQuery = useCardDetail(cardId)

  // Cancel = discard the draft, then close. Delete by the FRESHEST known version:
  // the detail cache if it has loaded (reflects any edit that bumped the
  // version), else the card we were handed, so a fast Cancel / ✕ before the
  // detail loads still cleans up.
  const cancel = () => {
    deleteCard.mutate(detailQuery.data?.card ?? card, { onSuccess: onClose })
  }

  return (
    <Modal
      opened
      onClose={cancel}
      closeOnClickOutside={false}
      closeButtonProps={{ 'aria-label': strings.common.close }}
      title={strings.newCard.modalTitle}
      size="lg"
      centered
      classNames={{ body: classes.modalScrollBody }}
    >
      <CardBody
        cardId={cardId}
        createMode
        onCancel={cancel}
        onCreated={onClose}
        cancelPending={deleteCard.isPending}
      />
    </Modal>
  )
}

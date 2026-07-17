import { type BoardCard } from '@rivian-kanban/core'
import { ActionIcon, Menu } from '@mantine/core'
import { DotsIcon } from '../shell/icons.tsx'
import { strings } from '../strings.ts'

export type CardMenuAction = 'open' | 'move' | 'block' | 'unblock' | 'cancel' | 'reopen'

export interface CardMenuProps {
  card: BoardCard
  /** Policy-driven affordances (ADR-013): disabled entries stay visible. */
  canCancel: boolean
  canReopen: boolean
  onAction: (action: CardMenuAction) => void
}

/**
 * The ⋯ menu: keyboard/touch path for moving (ADR-007) and the only path for
 * cancel/block/reopen (explicit actions, never drags).
 */
export function CardMenu({ card, canCancel, canReopen, onAction }: CardMenuProps) {
  const terminal = card.resolution !== null
  return (
    // Menu.Target owns the child's onClick, so the bubble-stop that keeps a
    // menu click from also opening the card panel lives on this wrapper.
    <span
      onClick={(event) => {
        event.stopPropagation()
      }}
    >
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" size="sm" aria-label={strings.card.menuLabel}>
            <DotsIcon size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            onClick={() => {
              onAction('open')
            }}
          >
            {strings.card.openCard}
          </Menu.Item>
          <Menu.Item
            onClick={() => {
              onAction('move')
            }}
          >
            {strings.card.moveTo}
          </Menu.Item>
          {card.blocked ? (
            <Menu.Item
              onClick={() => {
                onAction('unblock')
              }}
            >
              {strings.card.unblock}
            </Menu.Item>
          ) : (
            <Menu.Item
              onClick={() => {
                onAction('block')
              }}
            >
              {strings.card.block}
            </Menu.Item>
          )}
          {terminal ? (
            <Menu.Item
              disabled={!canReopen}
              onClick={() => {
                onAction('reopen')
              }}
            >
              {strings.card.reopen}
            </Menu.Item>
          ) : (
            <Menu.Item
              color="red"
              disabled={!canCancel}
              onClick={() => {
                onAction('cancel')
              }}
            >
              {strings.card.cancelCard}
            </Menu.Item>
          )}
        </Menu.Dropdown>
      </Menu>
    </span>
  )
}

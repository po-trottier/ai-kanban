import { type BoardCard } from '@rivian-kanban/core'
import { ActionIcon, Menu, Tooltip } from '@mantine/core'
import { DotsIcon } from '../shell/icons.tsx'
import { strings } from '../strings.ts'

export type CardMenuAction = 'open' | 'move' | 'block' | 'unblock' | 'cancel' | 'reopen' | 'archive'

export interface CardMenuProps {
  card: BoardCard
  /** Policy-driven affordances (ADR-013): disabled entries stay visible. */
  canCancel: boolean
  canReopen: boolean
  canArchive: boolean
  onAction: (action: CardMenuAction) => void
}

/**
 * The ⋯ menu: keyboard/touch path for moving (ADR-007) and the only path for
 * cancel/block/reopen (explicit actions, never drags).
 */
export function CardMenu({ card, canCancel, canReopen, canArchive, onAction }: CardMenuProps) {
  // A card sitting in Done carries a resolution (completed or a cancel kind);
  // the board query never surfaces archived cards, so a terminal board card is
  // exactly an archivable Done card (workflow.md#archival).
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
          <Tooltip label={strings.card.menuLabel}>
            <ActionIcon variant="subtle" color="gray" size="sm" aria-label={strings.card.menuLabel}>
              <DotsIcon size={16} />
            </ActionIcon>
          </Tooltip>
        </Menu.Target>
        <Menu.Dropdown>
          <Tooltip label={strings.tooltips.openCard} position="left" withArrow>
            <Menu.Item
              onClick={() => {
                onAction('open')
              }}
            >
              {strings.card.openCard}
            </Menu.Item>
          </Tooltip>
          <Tooltip label={strings.tooltips.move} position="left" withArrow>
            <Menu.Item
              onClick={() => {
                onAction('move')
              }}
            >
              {strings.card.moveTo}
            </Menu.Item>
          </Tooltip>
          {card.blocked ? (
            <Tooltip label={strings.tooltips.unblock} position="left" withArrow>
              <Menu.Item
                onClick={() => {
                  onAction('unblock')
                }}
              >
                {strings.card.unblock}
              </Menu.Item>
            </Tooltip>
          ) : (
            <Tooltip label={strings.tooltips.block} position="left" withArrow>
              <Menu.Item
                onClick={() => {
                  onAction('block')
                }}
              >
                {strings.card.block}
              </Menu.Item>
            </Tooltip>
          )}
          {terminal ? (
            <>
              {/* A disabled Menu.Item keeps `data-disabled` (not native disabled),
                  so it still fires hover events and the reason tooltip shows. */}
              <Tooltip
                label={
                  canReopen ? strings.tooltips.reopen : strings.tooltips.disabledReopenNoPermission
                }
                position="left"
                withArrow
              >
                <Menu.Item
                  color="green"
                  disabled={!canReopen}
                  onClick={() => {
                    onAction('reopen')
                  }}
                >
                  {strings.card.reopen}
                </Menu.Item>
              </Tooltip>
              <Tooltip
                label={
                  canArchive
                    ? strings.tooltips.archive
                    : strings.tooltips.disabledArchiveNoPermission
                }
                position="left"
                withArrow
              >
                <Menu.Item
                  color="red"
                  disabled={!canArchive}
                  onClick={() => {
                    onAction('archive')
                  }}
                >
                  {strings.card.archive}
                </Menu.Item>
              </Tooltip>
            </>
          ) : (
            <Tooltip
              label={
                canCancel
                  ? strings.tooltips.cancelCard
                  : strings.tooltips.disabledCancelNoPermission
              }
              position="left"
              withArrow
            >
              <Menu.Item
                color="red"
                disabled={!canCancel}
                onClick={() => {
                  onAction('cancel')
                }}
              >
                {strings.card.cancelCard}
              </Menu.Item>
            </Tooltip>
          )}
        </Menu.Dropdown>
      </Menu>
    </span>
  )
}

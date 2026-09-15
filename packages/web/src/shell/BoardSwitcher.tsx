import { type Board } from '@rivian-kanban/core'
import { Button, Divider, Menu, Skeleton, Text, Tooltip } from '@mantine/core'
import { ChevronDown, LayoutGrid, Settings } from 'lucide-react'
import { Link } from 'react-router'
import { strings } from '../strings.ts'
import classes from './board-switcher.module.css'

export interface BoardSwitcherProps {
  boards: readonly Board[]
  selectedId: string | null
  canManage: boolean
  loading: boolean
  onSelect: (boardId: string) => void
}

/**
 * Header board switcher: centered, truncates the current board's name at
 * every width (never icon-only). The trailing "Manage boards" entry ("Board
 * preferences" for non-admins) opens Settings → Boards. Selection
 * side effects (undo reset, panel close, navigate home) are AppLayout's job,
 * so the same reset happens regardless of what triggered the switch.
 */
export function BoardSwitcher({
  boards,
  selectedId,
  canManage,
  loading,
  onSelect,
}: BoardSwitcherProps) {
  const selected = boards.find((board) => board.id === selectedId) ?? null

  if (loading) return <Skeleton height={32} width={160} radius="sm" className={classes.skeleton} />

  if (boards.length === 0) {
    return (
      <Text size="sm" c="dimmed" className={classes.empty}>
        {strings.boards.empty}
      </Text>
    )
  }

  const label = selected?.name ?? strings.boards.empty

  return (
    <Menu position="bottom" withinPortal classNames={{ dropdown: classes.dropdown }}>
      <Menu.Target>
        <Tooltip label={strings.boards.switcherAriaLabel(label)}>
          <Button
            size="sm"
            variant="subtle"
            color="gray"
            aria-label={strings.boards.switcherAriaLabel(label)}
            className={classes.trigger}
            classNames={{ section: classes.section }}
            leftSection={<LayoutGrid size={16} aria-hidden />}
            rightSection={<ChevronDown size={14} aria-hidden />}
          >
            <Text size="sm" fw={500} className={classes.label}>
              {label}
            </Text>
          </Button>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{strings.boards.switcherLabel}</Menu.Label>
        {boards.map((board) => (
          <Tooltip key={board.id} label={strings.tooltips.switchBoard} position="left" withArrow>
            <Menu.Item
              className={classes.item}
              fw={board.id === selectedId ? 700 : 400}
              onClick={() => {
                if (board.id !== selectedId) onSelect(board.id)
              }}
            >
              <span className={classes.itemLabel}>{board.name}</span>
            </Menu.Item>
          </Tooltip>
        ))}
        <>
          <Divider />
          <Tooltip
            label={canManage ? strings.tooltips.manageBoards : strings.boards.preferredDefaultHelp}
            position="left"
            withArrow
          >
            <Menu.Item
              component={Link}
              to="/settings?tab=boards"
              leftSection={<Settings size={16} aria-hidden />}
            >
              {canManage ? strings.boards.manageBoards : strings.boards.boardPreferences}
            </Menu.Item>
          </Tooltip>
        </>
      </Menu.Dropdown>
    </Menu>
  )
}

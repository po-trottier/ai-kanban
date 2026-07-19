import { AppShell, Avatar, Group, Menu, Title, Tooltip, UnstyledButton } from '@mantine/core'
import { LogOut, Settings } from 'lucide-react'
import { useState } from 'react'
import { Link, Outlet, useNavigate } from 'react-router'
import { useLogout } from '../api/auth.ts'
import { useCurrentUser } from '../auth/session-context.ts'
import { CardPanel } from '../card/CardPanel.tsx'
import { initials } from '../lib/format.ts'
import { strings } from '../strings.ts'
import { SIZES } from '../theme.ts'
import { BoardLegend } from './BoardLegend.tsx'
import { CardPanelSlotContext } from './card-panel-slot.ts'
import { FilterBarSlotContext } from './filter-bar-slot.ts'
import { NewCardButton } from './NewCardButton.tsx'
import { NotificationBell } from './NotificationBell.tsx'
import { PanelResizeHandle } from './PanelResizeHandle.tsx'
import { SseBridge } from './SseBridge.tsx'
import { useCardPanelWidth } from './use-card-panel-width.ts'
import { useUndoRedoKeys } from '../undo/use-undo-redo-keys.ts'
import { cx } from '../lib/cx.ts'
import classes from './shell.module.css'

/**
 * Authenticated shell: a full-width header on top, then a full-width FILTER-BAR
 * strip (#128 — BoardPage portals its bar here), then the board+panel row. The
 * detail panel docks to the right of the BOARD row only, so opening or resizing
 * it squeezes the board — never the filter bar above it (which stays full width
 * and never reflows). The board scrolls independently under the panel; at the
 * small breakpoint the panel takes the whole board row (full-screen panel).
 */
export function AppLayout() {
  const me = useCurrentUser()
  const navigate = useNavigate()
  const logout = useLogout()
  // The deep-linked card id, published by the CardPanel route element.
  const [openCardId, setOpenCardId] = useState<string | null>(null)
  const panelOpen = openCardId !== null
  // The full-width filter-bar mount node (BoardPage portals its bar into it).
  // State (not a bare ref) so BoardPage re-renders once the node is attached.
  const [filterSlot, setFilterSlot] = useState<HTMLDivElement | null>(null)
  // Draggable, persisted width for the docked detail panel (desktop only; the
  // panel goes full-screen below the breakpoint via CSS).
  const panelResize = useCardPanelWidth()
  // Global Ctrl/Cmd+Z / Ctrl/Cmd+Y undo/redo of non-text board actions (ITEM 86);
  // mounted on the shell so it is live across the board and the docked panel,
  // yet bails while focus is in a text field so native in-field undo survives.
  useUndoRedoKeys()

  return (
    <CardPanelSlotContext.Provider value={{ openCardId, setOpenCardId }}>
      <FilterBarSlotContext.Provider value={filterSlot}>
        <AppShell
          header={{ height: SIZES.headerHeight }}
          padding="md"
          // While dragging, suppress selection/cursor flicker across the whole shell.
          className={cx(classes.shell, panelResize.resizing && classes.shellResizing)}
        >
          <SseBridge />
          <AppShell.Header>
            <div className={classes.header}>
              <Tooltip label={strings.tooltips.home}>
                <UnstyledButton component={Link} to="/" aria-label={strings.header.logoAlt}>
                  {/* Logo + wordmark: the logo is the brand, but the app title stays
                      as visible text beside it so the header always identifies the
                      app (the asset is a thin mark that reads faint on white). */}
                  <Group gap="xs" wrap="nowrap">
                    <img className={classes.logo} src="/logo.png" alt="" />
                    <Title order={1} size="h4">
                      {strings.appTitle}
                    </Title>
                  </Group>
                </UnstyledButton>
              </Tooltip>
              <Group gap="sm" ml="auto">
                {/* Right cluster, left→right: New card, the badge-legend help
                    icon, then the avatar menu (which carries the single Settings
                    entry — no separate gear). Board filtering lives in the filter
                    bar below the header now, so the header centre is empty. */}
                <NewCardButton />
                <BoardLegend />
                <NotificationBell />
                <Menu position="bottom-end">
                  <Menu.Target>
                    <Tooltip label={strings.header.accountMenu}>
                      <UnstyledButton aria-label={me.displayName}>
                        <Avatar color="indigo" radius="xl">
                          {initials(me.displayName)}
                        </Avatar>
                      </UnstyledButton>
                    </Tooltip>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Label>{me.displayName}</Menu.Label>
                    <Tooltip label={strings.tooltips.settings} position="left" withArrow>
                      <Menu.Item
                        component={Link}
                        to="/settings"
                        leftSection={<Settings size={16} aria-hidden />}
                      >
                        {strings.settings.menuItem}
                      </Menu.Item>
                    </Tooltip>
                    <Tooltip label={strings.tooltips.logout} position="left" withArrow>
                      <Menu.Item
                        leftSection={<LogOut size={16} aria-hidden />}
                        onClick={() => {
                          logout.mutate(undefined, {
                            onSettled: () => {
                              void navigate('/login')
                            },
                          })
                        }}
                      >
                        {strings.auth.logout}
                      </Menu.Item>
                    </Tooltip>
                  </Menu.Dropdown>
                </Menu>
              </Group>
            </div>
          </AppShell.Header>
          <AppShell.Main className={classes.main}>
            {/* Full-width filter-bar strip (#128): BoardPage portals its bar here,
                so it spans the whole width and never shrinks when the panel opens
                or is resized. flex:0 0 auto — a fixed row above the board+panel. */}
            <div className={classes.filterSlot} ref={setFilterSlot} />
            {/* The board + detail-panel row: the panel squeezes the board here,
                BELOW the filter bar. */}
            <div className={classes.boardRow}>
              <div className={classes.boardArea}>
                <Outlet />
              </div>
              {panelOpen ? (
                <aside
                  className={classes.panelColumn}
                  style={{ flexBasis: panelResize.width, width: panelResize.width }}
                >
                  <PanelResizeHandle resize={panelResize} />
                  <CardPanel cardId={openCardId} />
                </aside>
              ) : null}
            </div>
          </AppShell.Main>
        </AppShell>
      </FilterBarSlotContext.Provider>
    </CardPanelSlotContext.Provider>
  )
}

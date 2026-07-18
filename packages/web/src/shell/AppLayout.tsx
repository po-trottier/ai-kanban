import { AppShell, Avatar, Group, Menu, Title, Tooltip, UnstyledButton } from '@mantine/core'
import { LogOut, Settings } from 'lucide-react'
import { useState } from 'react'
import { Link, Outlet, useMatch, useNavigate } from 'react-router'
import { useLogout } from '../api/auth.ts'
import { useCurrentUser } from '../auth/session-context.ts'
import { SearchModal } from '../board/SearchModal.tsx'
import { CardPanel } from '../card/CardPanel.tsx'
import { initials } from '../lib/format.ts'
import { strings } from '../strings.ts'
import { CARD_PANEL_FULLSCREEN_BREAKPOINT, SIZES } from '../theme.ts'
import { BoardLegend } from './BoardLegend.tsx'
import { CardPanelSlotContext } from './card-panel-slot.ts'
import { HeaderSearch } from './HeaderSearch.tsx'
import { NewCardButton } from './NewCardButton.tsx'
import { PanelResizeHandle } from './PanelResizeHandle.tsx'
import { SseBridge } from './SseBridge.tsx'
import { useCardPanelWidth } from './use-card-panel-width.ts'
import { useUndoRedoKeys } from '../undo/use-undo-redo-keys.ts'
import { cx } from '../lib/cx.ts'
import classes from './shell.module.css'

/**
 * Authenticated shell: a full-width header on top, the board (Main) below, and
 * — when a card is deep-linked — a docked Aside pinned to the right BELOW the
 * header. The Aside never overlays the header or the board; Main shrinks and
 * scrolls independently under it (its own horizontal scrollbar). At the small
 * breakpoint the Aside takes the whole viewport (full-screen panel).
 */
export function AppLayout() {
  const me = useCurrentUser()
  const navigate = useNavigate()
  const logout = useLogout()
  // The header filter only drives the board; it does nothing on /search or
  // /settings, so it renders only on the board route (and its deep-linked card
  // panel) — a facilities user is never shown a filter that silently no-ops.
  // Both matches run unconditionally (rules-of-hooks) then combine.
  const boardMatch = useMatch('/')
  const cardPanelMatch = useMatch('/cards/:cardId')
  const onBoardRoute = boardMatch !== null || cardPanelMatch !== null
  // The deep-linked card id, published by the CardPanel route element.
  const [openCardId, setOpenCardId] = useState<string | null>(null)
  const panelOpen = openCardId !== null
  // Draggable, persisted width for the docked detail panel (desktop only; the
  // panel goes full-screen below the breakpoint).
  const panelResize = useCardPanelWidth()
  // Global Ctrl/Cmd+Z / Ctrl/Cmd+Y undo/redo of non-text board actions (ITEM 86);
  // mounted on the shell so it is live across the board and the docked panel,
  // yet bails while focus is in a text field so native in-field undo survives.
  useUndoRedoKeys()

  return (
    <CardPanelSlotContext.Provider value={{ openCardId, setOpenCardId }}>
      <AppShell
        header={{ height: SIZES.headerHeight }}
        // Reserve the docked Aside only when a card is open, so Main uses the
        // full width otherwise (exactOptionalPropertyTypes: omit, never pass
        // undefined).
        {...(panelOpen
          ? {
              aside: {
                width: panelResize.width,
                breakpoint: CARD_PANEL_FULLSCREEN_BREAKPOINT,
                collapsed: { desktop: false, mobile: false },
              },
            }
          : {})}
        padding="md"
        // While dragging, suppress selection/cursor flicker across the whole shell.
        className={cx(classes.shell, panelResize.resizing && classes.shellResizing)}
      >
        <SseBridge />
        <AppShell.Header>
          <div className={classes.header}>
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
            <div className={classes.headerSearch}>{onBoardRoute ? <HeaderSearch /> : null}</div>
            <Group gap="sm">
              {/* Right cluster (ITEM A), left→right: New card, the badge-legend
                  help icon, then the avatar menu (which now carries the single
                  Settings entry — no separate gear). The centered live-search
                  (above) and this help icon replace the former "Search cards"
                  and "What do the badges mean?" text buttons; global/archived
                  search stays reachable via /search from the header-filter
                  empty state. */}
              <NewCardButton />
              <BoardLegend />
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
                  <Menu.Item
                    component={Link}
                    to="/settings"
                    leftSection={<Settings size={16} aria-hidden />}
                  >
                    {strings.settings.menuItem}
                  </Menu.Item>
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
                </Menu.Dropdown>
              </Menu>
            </Group>
          </div>
        </AppShell.Header>
        <AppShell.Main className={classes.main}>
          <Outlet />
        </AppShell.Main>
        {panelOpen ? (
          <AppShell.Aside className={classes.aside}>
            <PanelResizeHandle resize={panelResize} />
            <CardPanel cardId={openCardId} />
          </AppShell.Aside>
        ) : null}
        {/* Advanced search is board-scoped (archived + facet search over every
            card); mounted only on the board route, opened via `?search=1`. */}
        {onBoardRoute ? <SearchModal /> : null}
      </AppShell>
    </CardPanelSlotContext.Provider>
  )
}

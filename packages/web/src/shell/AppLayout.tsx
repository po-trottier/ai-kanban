import {
  ActionIcon,
  AppShell,
  Avatar,
  Button,
  Group,
  Menu,
  Title,
  UnstyledButton,
} from '@mantine/core'
import { useState } from 'react'
import { Link, Outlet, useNavigate } from 'react-router'
import { useLogout } from '../api/auth.ts'
import { useCurrentUser } from '../auth/session-context.ts'
import { CardPanel } from '../card/CardPanel.tsx'
import { initials } from '../lib/format.ts'
import { strings } from '../strings.ts'
import { CARD_PANEL_FULLSCREEN_BREAKPOINT, SIZES } from '../theme.ts'
import { BoardLegend } from './BoardLegend.tsx'
import { CardPanelSlotContext } from './card-panel-slot.ts'
import { GearIcon } from './icons.tsx'
import { NewCardButton } from './NewCardButton.tsx'
import { SseBridge } from './SseBridge.tsx'
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
  // The deep-linked card id, published by the CardPanel route element.
  const [openCardId, setOpenCardId] = useState<string | null>(null)
  const panelOpen = openCardId !== null

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
                width: SIZES.cardPanelWidth,
                breakpoint: CARD_PANEL_FULLSCREEN_BREAKPOINT,
                collapsed: { desktop: false, mobile: false },
              },
            }
          : {})}
        padding="md"
        className={classes.shell}
      >
        <SseBridge />
        <AppShell.Header>
          <Group h="100%" px="md" justify="space-between">
            <UnstyledButton component={Link} to="/">
              <Title order={1} size="h4">
                {strings.appTitle}
              </Title>
            </UnstyledButton>
            <Group gap="sm">
              <BoardLegend />
              <Button component={Link} to="/search" variant="subtle" color="gray" size="sm">
                {strings.search.openButton}
              </Button>
              <NewCardButton />
              {me.role === 'admin' ? (
                <ActionIcon
                  component={Link}
                  to="/settings"
                  variant="subtle"
                  color="gray"
                  size="lg"
                  aria-label={strings.settings.gearLabel}
                >
                  <GearIcon />
                </ActionIcon>
              ) : null}
              <Menu position="bottom-end">
                <Menu.Target>
                  <UnstyledButton aria-label={me.displayName}>
                    <Avatar color="indigo" radius="xl">
                      {initials(me.displayName)}
                    </Avatar>
                  </UnstyledButton>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>{me.displayName}</Menu.Label>
                  <Menu.Item
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
          </Group>
        </AppShell.Header>
        <AppShell.Main className={classes.main}>
          <Outlet />
        </AppShell.Main>
        {panelOpen ? (
          <AppShell.Aside className={classes.aside}>
            <CardPanel cardId={openCardId} />
          </AppShell.Aside>
        ) : null}
      </AppShell>
    </CardPanelSlotContext.Provider>
  )
}

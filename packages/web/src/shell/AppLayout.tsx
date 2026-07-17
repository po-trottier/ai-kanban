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
import { Link, Outlet, useNavigate } from 'react-router'
import { useLogout } from '../api/auth.ts'
import { useCurrentUser } from '../auth/session-context.ts'
import { initials } from '../lib/format.ts'
import { strings } from '../strings.ts'
import { SIZES } from '../theme.ts'
import { NewCardButton } from './NewCardButton.tsx'
import { SseBridge } from './SseBridge.tsx'
import classes from './shell.module.css'

/** Authenticated shell: header (title, new card, settings, user menu) + page. */
export function AppLayout() {
  const me = useCurrentUser()
  const navigate = useNavigate()
  const logout = useLogout()

  return (
    <AppShell header={{ height: SIZES.headerHeight }} padding="md" className={classes.shell}>
      <SseBridge />
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <UnstyledButton component={Link} to="/">
            <Title order={1} size="h4">
              {strings.appTitle}
            </Title>
          </UnstyledButton>
          <Group gap="sm">
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
                ⚙
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
    </AppShell>
  )
}

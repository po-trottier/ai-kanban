import { Alert, Container, Stack, Tabs, Title } from '@mantine/core'
import { usePutPolicy } from '../api/admin.ts'
import { useBoard } from '../api/board.ts'
import { usePolicy } from '../api/meta.ts'
import { useCurrentUser } from '../auth/session-context.ts'
import { strings } from '../strings.ts'
import { LanesAdmin } from './LanesAdmin.tsx'
import { LocationsAdmin } from './LocationsAdmin.tsx'
import { PolicyEditorForm } from './PolicyEditorForm.tsx'
import { TokensAdmin } from './TokensAdmin.tsx'
import { UsersAdmin } from './UsersAdmin.tsx'

/** App-wide admin settings — the only role-gated surface (ADR-013). */
export function SettingsPage() {
  const me = useCurrentUser()
  const policy = usePolicy()
  const board = useBoard()
  const putPolicy = usePutPolicy()

  if (me.role !== 'admin') {
    return (
      <Container size="sm" mt="xl">
        <Alert color="red">{strings.settings.adminsOnly}</Alert>
      </Container>
    )
  }

  const laneLabels = Object.fromEntries(
    (board.data?.lanes ?? []).map((snapshot) => [snapshot.lane.key, snapshot.lane.label]),
  )

  return (
    <Container size="md" w="100%">
      <Stack gap="md">
        <Title order={2} size="h3">
          {strings.settings.pageTitle}
        </Title>
        <Tabs defaultValue="users" keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="users">{strings.settings.tabUsers}</Tabs.Tab>
            <Tabs.Tab value="lanes">{strings.settings.tabLanes}</Tabs.Tab>
            <Tabs.Tab value="policy">{strings.settings.tabPolicy}</Tabs.Tab>
            <Tabs.Tab value="locations">{strings.settings.tabLocations}</Tabs.Tab>
            <Tabs.Tab value="tokens">{strings.settings.tabTokens}</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="users" pt="md">
            <UsersAdmin />
          </Tabs.Panel>
          <Tabs.Panel value="lanes" pt="md">
            <LanesAdmin />
          </Tabs.Panel>
          <Tabs.Panel value="policy" pt="md">
            {policy.data !== undefined ? (
              <PolicyEditorForm
                // Remount on refetch (own save round-trip or SSE policy.updated)
                // so the editor never PUTs a stale snapshot over someone else's.
                key={policy.dataUpdatedAt}
                value={policy.data}
                laneLabels={laneLabels}
                saving={putPolicy.isPending}
                onSave={(document) => {
                  putPolicy.mutate(document)
                }}
              />
            ) : null}
          </Tabs.Panel>
          <Tabs.Panel value="locations" pt="md">
            <LocationsAdmin />
          </Tabs.Panel>
          <Tabs.Panel value="tokens" pt="md">
            <TokensAdmin />
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Container>
  )
}

import { Container, Stack, Tabs, Title } from '@mantine/core'
import { usePutPolicy } from '../api/admin.ts'
import { useBoard } from '../api/board.ts'
import { usePolicy } from '../api/meta.ts'
import { isConflictError } from '../api/problem.ts'
import { canManageAnything } from '../auth/permissions.ts'
import { useCurrentUser } from '../auth/session-context.ts'
import { strings } from '../strings.ts'
import { LanesAdmin } from './LanesAdmin.tsx'
import { LocationsAdmin } from './LocationsAdmin.tsx'
import { PolicyEditorForm } from './PolicyEditorForm.tsx'
import { PreferencesTab } from './PreferencesTab.tsx'
import { TokensAdmin } from './TokensAdmin.tsx'
import { UsersAdmin } from './UsersAdmin.tsx'

/**
 * The Settings page: a Preferences tab every role can open (their per-user time
 * zone + theme), plus the admin tabs — Users, Columns, Permissions, Locations,
 * Service tokens — shown only to roles with any manage* grant (ADR-013). A
 * non-admin sees only Preferences; there is no admins-only wall (everyone can
 * open Settings for their preferences).
 */
export function SettingsPage() {
  const me = useCurrentUser()
  const policy = usePolicy()
  const board = useBoard()
  const putPolicy = usePutPolicy()

  const canManage = policy.data !== undefined && canManageAnything(policy.data, me.role)

  const laneLabels = Object.fromEntries(
    (board.data?.lanes ?? []).map((snapshot) => [snapshot.lane.key, snapshot.lane.label]),
  )

  return (
    <Container size="md" w="100%">
      <Stack gap="md">
        <Title order={2} size="h3">
          {strings.settings.pageTitle}
        </Title>
        <Tabs defaultValue="preferences" keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="preferences">{strings.settings.tabPreferences}</Tabs.Tab>
            {canManage ? (
              <>
                <Tabs.Tab value="users">{strings.settings.tabUsers}</Tabs.Tab>
                <Tabs.Tab value="lanes">{strings.settings.tabLanes}</Tabs.Tab>
                <Tabs.Tab value="policy">{strings.settings.tabPolicy}</Tabs.Tab>
                <Tabs.Tab value="locations">{strings.settings.tabLocations}</Tabs.Tab>
                <Tabs.Tab value="tokens">{strings.settings.tabTokens}</Tabs.Tab>
              </>
            ) : null}
          </Tabs.List>
          <Tabs.Panel value="preferences" pt="md">
            <PreferencesTab />
          </Tabs.Panel>
          {canManage ? (
            <>
              <Tabs.Panel value="users" pt="md">
                <UsersAdmin />
              </Tabs.Panel>
              <Tabs.Panel value="lanes" pt="md">
                <LanesAdmin />
              </Tabs.Panel>
              <Tabs.Panel value="policy" pt="md">
                {/* canManage already narrows policy.data to defined here. */}
                <PolicyEditorForm
                  // Remount on refetch (own save round-trip or SSE policy.updated)
                  // so the editor never PUTs a stale snapshot over someone else's.
                  key={policy.dataUpdatedAt}
                  value={policy.data}
                  laneLabels={laneLabels}
                  saving={putPolicy.isPending}
                  roleInUseError={isConflictError(putPolicy.error)}
                  onSave={(document) => {
                    putPolicy.mutate(document)
                  }}
                />
              </Tabs.Panel>
              <Tabs.Panel value="locations" pt="md">
                <LocationsAdmin />
              </Tabs.Panel>
              <Tabs.Panel value="tokens" pt="md">
                <TokensAdmin />
              </Tabs.Panel>
            </>
          ) : null}
        </Tabs>
      </Stack>
    </Container>
  )
}

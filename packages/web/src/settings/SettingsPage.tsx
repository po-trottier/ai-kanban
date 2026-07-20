import { Container, Stack, Tabs, Title } from '@mantine/core'
import { useSearchParams } from 'react-router'
import { usePutPolicy } from '../api/admin.ts'
import { usePolicy } from '../api/meta.ts'
import { isConflictError } from '../api/problem.ts'
import { roleGrants } from '../auth/permissions.ts'
import { useCurrentUser } from '../auth/session-context.ts'
import { strings } from '../strings.ts'
import { LanesAdmin } from './LanesAdmin.tsx'
import { LocationsAdmin } from './LocationsAdmin.tsx'
import { PolicyEditorForm } from './PolicyEditorForm.tsx'
import { PreferencesTab } from './PreferencesTab.tsx'
import { TokensAdmin } from './TokensAdmin.tsx'
import { UsersAdmin } from './UsersAdmin.tsx'

/**
 * The Settings page: a Preferences tab EVERY role can open (their per-user time
 * zone + theme), plus admin tabs gated PER TAB — each appears only to roles that
 * grant its specific permission (ADR-013), so a user never sees a tab they can't
 * act on. A plain user sees only Preferences; there is no admins-only wall.
 */
export function SettingsPage() {
  const me = useCurrentUser()
  const policy = usePolicy()
  const putPolicy = usePutPolicy()
  // The active tab is mirrored in the URL (?tab=locations) so deep links — e.g.
  // the empty LocationPicker's "Settings" link — open the right tab directly.
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') ?? 'preferences'

  const can = (permission: Parameters<typeof roleGrants>[2]) =>
    roleGrants(policy.data, me.role, permission)
  const canUsers = can('manageUsers')
  const canLanes = can('manageLanes')
  const canPolicy = can('managePolicy')
  const canLocations = can('manageLocations')
  const canTokens = can('manageTokens')

  return (
    <Container size="md" w="100%">
      <Stack gap="md">
        <Title order={2} size="h3">
          {strings.settings.pageTitle}
        </Title>
        <Tabs
          value={activeTab}
          onChange={(next) => {
            setSearchParams(next === null ? {} : { tab: next }, { replace: true })
          }}
          keepMounted={false}
        >
          <Tabs.List>
            <Tabs.Tab value="preferences">{strings.settings.tabPreferences}</Tabs.Tab>
            {canUsers ? <Tabs.Tab value="users">{strings.settings.tabUsers}</Tabs.Tab> : null}
            {canLanes ? <Tabs.Tab value="lanes">{strings.settings.tabLanes}</Tabs.Tab> : null}
            {canPolicy ? <Tabs.Tab value="policy">{strings.settings.tabPolicy}</Tabs.Tab> : null}
            {canLocations ? (
              <Tabs.Tab value="locations">{strings.settings.tabLocations}</Tabs.Tab>
            ) : null}
            {canTokens ? <Tabs.Tab value="tokens">{strings.settings.tabTokens}</Tabs.Tab> : null}
          </Tabs.List>
          <Tabs.Panel value="preferences" pt="md">
            <PreferencesTab />
          </Tabs.Panel>
          {canUsers ? (
            <Tabs.Panel value="users" pt="md">
              <UsersAdmin />
            </Tabs.Panel>
          ) : null}
          {canLanes ? (
            <Tabs.Panel value="lanes" pt="md">
              <LanesAdmin />
            </Tabs.Panel>
          ) : null}
          {canPolicy && policy.data !== undefined ? (
            <Tabs.Panel value="policy" pt="md">
              <PolicyEditorForm
                // Remount on refetch (own save round-trip or SSE policy.updated)
                // so the editor never PUTs a stale snapshot over someone else's.
                key={policy.dataUpdatedAt}
                value={policy.data}
                saving={putPolicy.isPending}
                roleInUseError={isConflictError(putPolicy.error)}
                onSave={(document) => {
                  putPolicy.mutate(document)
                }}
              />
            </Tabs.Panel>
          ) : null}
          {canLocations ? (
            <Tabs.Panel value="locations" pt="md">
              <LocationsAdmin />
            </Tabs.Panel>
          ) : null}
          {canTokens ? (
            <Tabs.Panel value="tokens" pt="md">
              <TokensAdmin />
            </Tabs.Panel>
          ) : null}
        </Tabs>
      </Stack>
    </Container>
  )
}

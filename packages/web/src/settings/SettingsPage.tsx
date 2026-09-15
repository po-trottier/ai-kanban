import { Container, ScrollArea, Select, Stack, Tabs, Title } from '@mantine/core'
import { useContext, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'
import { usePutPolicy } from '../api/admin.ts'
import { useBoardCatalog } from '../api/boards.ts'
import { usePolicy } from '../api/meta.ts'
import { isConflictError } from '../api/problem.ts'
import { roleGrants } from '../auth/permissions.ts'
import { useCurrentUser } from '../auth/session-context.ts'
import { strings } from '../strings.ts'
import { BoardScopeContext } from '../shell/board-scope.ts'
import { BoardsAdmin } from './BoardsAdmin.tsx'
import { GroupsAdmin } from './GroupsAdmin.tsx'
import { LanesAdmin } from './LanesAdmin.tsx'
import { LocationsAdmin } from './LocationsAdmin.tsx'
import { PolicyEditorForm } from './PolicyEditorForm.tsx'
import { PreferencesTab } from './PreferencesTab.tsx'
import { TokensAdmin } from './TokensAdmin.tsx'
import { UsersAdmin } from './UsersAdmin.tsx'
import { WorkingHoursForm } from './WorkingHoursForm.tsx'
import { WaitingReasonsForm } from './WaitingReasonsForm.tsx'
import classes from './settings.module.css'

/**
 * Preferences and Boards are open to every role, plus admin tabs gated PER TAB — each appears only to roles that
 * grant its specific permission (ADR-013), so a user never sees a tab they can't
 * act on. A plain user sees Preferences and Boards; there is no admins-only wall.
 */
export function SettingsPage() {
  const me = useCurrentUser()
  const boardScope = useContext(BoardScopeContext)
  const policy = usePolicy(boardScope?.boardId !== null)
  const putPolicy = usePutPolicy()
  // Board management is gated inside the otherwise readable Boards tab.
  const boardCatalog = useBoardCatalog()
  // The active tab is mirrored in the URL (?tab=locations) so deep links — e.g.
  // the empty LocationPicker's "Settings" link — open the right tab directly.
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') ?? 'preferences'
  const tabList = useRef<HTMLDivElement>(null)
  const tabsReady = !policy.isPending && !boardCatalog.isPending
  useEffect(() => {
    tabList.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTab, tabsReady])

  const can = (permission: Parameters<typeof roleGrants>[2]) =>
    roleGrants(policy.data, me.role, permission)
  const canUsers = can('manageUsers')
  const canLanes = can('manageLanes')
  const canPolicy = can('managePolicy')
  const canLocations = can('manageLocations')
  const canTokens = can('manageTokens')

  return (
    <Container size="md" w="100%" px={{ base: 0, sm: 'md' }} className={classes.page}>
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
          <ScrollArea type="auto" scrollbars="x" offsetScrollbars="x">
            <Tabs.List
              ref={tabList}
              className={classes.tabList}
              onFocusCapture={(event) => {
                event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
              }}
            >
              <Tabs.Tab value="preferences">{strings.settings.tabPreferences}</Tabs.Tab>
              <Tabs.Tab value="boards">{strings.settings.tabBoards}</Tabs.Tab>
              {canLanes ? <Tabs.Tab value="lanes">{strings.settings.tabLanes}</Tabs.Tab> : null}
              {canPolicy ? (
                <Tabs.Tab value="waiting-reasons">{strings.settings.tabWaitingReasons}</Tabs.Tab>
              ) : null}
              {canPolicy ? <Tabs.Tab value="hours">{strings.settings.tabHours}</Tabs.Tab> : null}
              {canLocations ? (
                <Tabs.Tab value="locations">{strings.settings.tabLocations}</Tabs.Tab>
              ) : null}
              {canUsers ? <Tabs.Tab value="users">{strings.settings.tabUsers}</Tabs.Tab> : null}
              {canPolicy ? <Tabs.Tab value="groups">{strings.settings.tabGroups}</Tabs.Tab> : null}
              {canPolicy ? <Tabs.Tab value="policy">{strings.settings.tabPolicy}</Tabs.Tab> : null}
              {canTokens ? <Tabs.Tab value="tokens">{strings.settings.tabTokens}</Tabs.Tab> : null}
            </Tabs.List>
          </ScrollArea>
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
              <Select
                label={strings.lanes.boardLabel}
                description={strings.lanes.boardHelp}
                mb="md"
                searchable
                allowDeselect={false}
                data={(boardCatalog.data?.items ?? []).map((board) => ({
                  value: board.id,
                  label: board.name,
                }))}
                value={boardScope?.boardId ?? null}
                onChange={(boardId) => {
                  if (boardId !== null) boardScope?.setBoardId(boardId)
                }}
              />
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
          {canPolicy && policy.data !== undefined ? (
            <Tabs.Panel value="hours" pt="md">
              <WorkingHoursForm
                key={policy.dataUpdatedAt}
                value={policy.data}
                saving={putPolicy.isPending}
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
          {canPolicy && policy.data !== undefined ? (
            <Tabs.Panel value="waiting-reasons" pt="md">
              <WaitingReasonsForm
                key={policy.dataUpdatedAt}
                value={policy.data}
                saving={putPolicy.isPending}
                onSave={(document) => {
                  putPolicy.mutate(document)
                }}
              />
            </Tabs.Panel>
          ) : null}
          {canTokens ? (
            <Tabs.Panel value="tokens" pt="md">
              <TokensAdmin />
            </Tabs.Panel>
          ) : null}
          <Tabs.Panel value="boards" pt="md">
            <BoardsAdmin />
          </Tabs.Panel>
          {canPolicy ? (
            <Tabs.Panel value="groups" pt="md">
              <GroupsAdmin />
            </Tabs.Panel>
          ) : null}
        </Tabs>
      </Stack>
    </Container>
  )
}

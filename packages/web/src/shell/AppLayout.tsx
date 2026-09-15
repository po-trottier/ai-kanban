import { AppShell, Avatar, Group, Menu, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core'
import { QueryClientProvider } from '@tanstack/react-query'
import { LogOut, Settings } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation, useMatch, useNavigate } from 'react-router'
import { ApiContext } from '../api/api-context.ts'
import { useLogout } from '../api/auth.ts'
import { useBoardCatalog } from '../api/boards.ts'
import { useCardBoardResolve } from '../api/card.ts'
import { useGlobalApi, useGlobalQueryClient } from '../api/global-api-context.ts'
import { createScopedQueryClient } from '../api/query-client.ts'
import { useCurrentUser } from '../auth/session-context.ts'
import { CardPanel } from '../card/CardPanel.tsx'
import { initials } from '../lib/format.ts'
import { strings } from '../strings.ts'
import { SIZES } from '../theme.ts'
import { BoardLegend } from './BoardLegend.tsx'
import { BoardScopeContext, useSelectedBoardId } from './board-scope.ts'
import { BoardSwitcher } from './BoardSwitcher.tsx'
import { CardPanelSlotContext } from './card-panel-slot.ts'
import { ErrorAlert } from './ErrorAlert.tsx'
import { FilterBarSlotContext } from './filter-bar-slot.ts'
import { HintButton } from './HintButton.tsx'
import { NewCardButton } from './NewCardButton.tsx'
import { NotificationBell } from './NotificationBell.tsx'
import { PanelResizeHandle } from './PanelResizeHandle.tsx'
import { SseBridge } from './SseBridge.tsx'
import { useCardPanelWidth } from './use-card-panel-width.ts'
import { useUndoRedoKeys } from '../undo/use-undo-redo-keys.ts'
import { resetActionHistory } from '../undo/action-history.ts'
import { cx } from '../lib/cx.ts'
import classes from './shell.module.css'

/**
 * The board-scoped ApiClient/QueryClient pair, held in `useState` (never
 * recomputed) and remounted by the `key={boardId}` at the call site below —
 * a true unmount/remount, not a memoized swap, so every React Query
 * observer/subscription from the PRIOR board is dropped rather than reused.
 */
function BoardScopedProviders({
  boardId,
  children,
}: {
  boardId: string | null
  children: ReactNode
}) {
  const globalApi = useGlobalApi()
  const globalQueryClient = useGlobalQueryClient()
  const [scopedApi] = useState(() => globalApi.withBoard(boardId ?? undefined))
  const [scopedQueryClient] = useState(() => createScopedQueryClient(globalQueryClient))
  useEffect(() => {
    return () => {
      scopedQueryClient.clear()
    }
  }, [scopedQueryClient])
  return (
    <QueryClientProvider client={scopedQueryClient}>
      <ApiContext.Provider value={scopedApi}>{children}</ApiContext.Provider>
    </QueryClientProvider>
  )
}

/**
 * Authenticated shell: a full-width header, then a full-width filter-bar
 * strip, then the board+panel row. Session/catalog/notifications always read
 * the GLOBAL api+queryClient (api/global-api-context.ts) regardless of where
 * they're rendered; board/card data reads whatever `ApiContext`/query client
 * is ambient — the outer pair until a board is selected, then the scoped
 * pair from `BoardScopedProviders`.
 */
export function AppLayout() {
  const me = useCurrentUser()
  const navigate = useNavigate()
  const location = useLocation()
  const logout = useLogout()
  const [openCardId, setOpenCardId] = useState<string | null>(null)
  const panelOpen = openCardId !== null
  const [filterSlot, setFilterSlot] = useState<HTMLDivElement | null>(null)
  const panelResize = useCardPanelWidth()
  useUndoRedoKeys()

  const catalog = useBoardCatalog()
  const boards = catalog.data?.items
  const canManageBoards = catalog.data?.canManage ?? false
  const { boardId, setBoardId } = useSelectedBoardId(boards, catalog.data?.defaultBoardId)
  const boardName = boards?.find((board) => board.id === boardId)?.name
  useEffect(() => {
    document.title = boardName === undefined ? strings.appTitle : strings.boardTitle(boardName)
    return () => {
      document.title = strings.appTitle
    }
  }, [boardName])
  const switchingBoard = useRef(false)
  const cardMatch = useMatch('/cards/:cardId')
  const linkedCard = useCardBoardResolve(cardMatch?.params.cardId ?? '')
  const linkedBoardId = linkedCard.data?.card.boardId
  const linkedBoardAllowed =
    linkedBoardId !== undefined && (boards?.some((board) => board.id === linkedBoardId) ?? false)
  useEffect(() => {
    if (cardMatch === null) {
      switchingBoard.current = false
      return
    }
    // Router navigation can commit after the selected-board state. An explicit
    // switch wins over the old card URL during that brief transition.
    if (switchingBoard.current || !linkedBoardAllowed || linkedBoardId === boardId) return
    setBoardId(linkedBoardId)
    const search = new URLSearchParams(location.search)
    for (const key of [...search.keys()]) if (key !== 'tab' && key !== 'comment') search.delete(key)
    void navigate({ pathname: location.pathname, search: search.toString() }, { replace: true })
  }, [
    cardMatch,
    linkedBoardAllowed,
    linkedBoardId,
    boardId,
    setBoardId,
    location.pathname,
    location.search,
    navigate,
  ])

  // Resets transient board-scoped UI on EVERY selection change — a dropdown
  // click, a revoked selection auto-recovering to another board, anything —
  // not only the explicit switcher. A deep link into another board's card
  // manages its own transition (CardPanelRoute), so it's left alone here.
  const previousBoardIdRef = useRef(boardId)
  useEffect(() => {
    if (previousBoardIdRef.current === boardId) return
    const previousBoardId = previousBoardIdRef.current
    previousBoardIdRef.current = boardId
    resetActionHistory()
    if (previousBoardId === null) return
    if (!location.pathname.startsWith('/cards/')) {
      // Synchronizing with the router, not deriving state from a prop — the
      // panel-close is part of that same external navigation reaction.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpenCardId(null)
      // Settings can select another board while staying on the same editor tab.
      if (!location.pathname.startsWith('/settings')) void navigate('/')
    }
  }, [boardId, location.pathname, navigate])

  const onSettingsRoute = location.pathname.startsWith('/settings')

  return (
    <BoardScopeContext.Provider value={{ boardId, setBoardId }}>
      <CardPanelSlotContext.Provider value={{ openCardId, setOpenCardId }}>
        <FilterBarSlotContext.Provider value={filterSlot}>
          <BoardScopedProviders key={boardId ?? 'none'} boardId={boardId}>
            <AppShell
              header={{ height: SIZES.headerHeight }}
              padding="md"
              // While dragging, suppress selection/cursor flicker across the whole shell.
              className={cx(classes.shell, panelResize.resizing && classes.shellResizing)}
            >
              <SseBridge boardId={boardId} />
              <AppShell.Header>
                <div className={classes.header}>
                  <Tooltip label={strings.tooltips.home}>
                    <UnstyledButton component={Link} to="/" aria-label={strings.header.logoAlt}>
                      <img className={classes.logo} src="/logo.png" alt="" />
                    </UnstyledButton>
                  </Tooltip>
                  <div className={classes.boardSwitcherWrap}>
                    <BoardSwitcher
                      boards={boards ?? []}
                      selectedId={boardId}
                      canManage={canManageBoards}
                      loading={catalog.isPending}
                      onSelect={(nextBoardId) => {
                        if (nextBoardId === boardId) return
                        switchingBoard.current = true
                        setOpenCardId(null)
                        resetActionHistory()
                        setBoardId(nextBoardId)
                        void navigate('/')
                      }}
                    />
                  </div>
                  <Group gap="xs" ml="auto" wrap="nowrap" className={classes.headerActions}>
                    {/* No board selected yet ⇒ nothing to create a card into. */}
                    {boardId !== null ? <NewCardButton compactOnMobile /> : null}
                    {boardId !== null ? <BoardLegend /> : null}
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
                {/* Full-width filter-bar strip: BoardPage portals its bar here,
                    above the board+panel row, so it never shrinks/reflows. */}
                <div className={classes.filterSlot} ref={setFilterSlot} />
                {onSettingsRoute ? (
                  // Settings (Preferences + admin tabs) works regardless of the
                  // board catalog's state — a no-board user still needs it.
                  <Outlet />
                ) : catalog.isError ? (
                  <Stack align="center" justify="center" className={classes.boardArea} gap="sm">
                    <ErrorAlert error={catalog.error} fallbackMessage={strings.boards.loadFailed} />
                    <HintButton
                      tooltip={strings.tooltips.reload}
                      onClick={() => {
                        void catalog.refetch()
                      }}
                    >
                      {strings.common.reload}
                    </HintButton>
                  </Stack>
                ) : cardMatch !== null &&
                  (linkedCard.isError ||
                    (linkedCard.isSuccess && catalog.isSuccess && !linkedBoardAllowed)) ? (
                  <Stack p="md">
                    <ErrorAlert
                      error={linkedCard.error}
                      fallbackMessage="This work order is unavailable."
                    />
                  </Stack>
                ) : cardMatch !== null && (!linkedBoardAllowed || linkedBoardId !== boardId) ? (
                  <Text c="dimmed" p="md" role="status" aria-label={strings.common.loading}>
                    {strings.common.loading}
                  </Text>
                ) : boardId === null ? (
                  catalog.isPending ? (
                    <Stack align="center" justify="center" className={classes.boardArea}>
                      <Text c="dimmed">{strings.common.loading}</Text>
                    </Stack>
                  ) : (
                    <Stack align="center" justify="center" className={classes.boardArea} gap="xs">
                      <Text fw={600}>{strings.boards.empty}</Text>
                      <Text c="dimmed" size="sm">
                        {strings.boards.emptyHint}
                      </Text>
                    </Stack>
                  )
                ) : (
                  <div className={cx(classes.boardRow, panelOpen && classes.panelOpen)}>
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
                )}
              </AppShell.Main>
            </AppShell>
          </BoardScopedProviders>
        </FilterBarSlotContext.Provider>
      </CardPanelSlotContext.Provider>
    </BoardScopeContext.Provider>
  )
}

import { type RouteObject } from 'react-router'
import { LoginPage } from '../auth/LoginPage.tsx'
import { RequireAuth } from '../auth/RequireAuth.tsx'
import { BoardPage } from '../board/BoardPage.tsx'
import { CardSearchPage } from '../board/CardSearchPage.tsx'
import { CardPanel } from '../card/CardPanel.tsx'
import { SettingsPage } from '../settings/SettingsPage.tsx'
import { AppLayout } from '../shell/AppLayout.tsx'

/**
 * Route table (shared by the browser router and memory routers in tests).
 * `/cards/:cardId` deep-links the detail panel over the board.
 */
export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          {
            path: '/',
            element: <BoardPage />,
            children: [{ path: 'cards/:cardId', element: <CardPanel /> }],
          },
          { path: '/search', element: <CardSearchPage /> },
          { path: '/settings', element: <SettingsPage /> },
        ],
      },
    ],
  },
]

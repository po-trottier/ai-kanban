import { type User } from '@rivian-kanban/core'
import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import { type ReactNode } from 'react'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router'
import { ApiContext } from '../api/api-context.ts'
import { ApiClient, type FetchLike } from '../api/client.ts'
import { routes } from '../app/routes.tsx'
import { SessionContext } from '../auth/session-context.ts'
import { fixtureAdmin } from './fixtures.ts'
import { cssVariablesResolver, theme } from '../theme.ts'

export interface RenderOptions {
  /** Hand-written fake fetch; omit for prop-only component tests. */
  fetchFn?: FetchLike
  /** Session user provided via context (defaults to the fixture admin). */
  user?: User | null
  route?: string
}

function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
}

/** Shared providers: Mantine (test env), real QueryClient, injected ApiClient. */
export function renderWithProviders(ui: ReactNode, options: RenderOptions = {}): RenderResult {
  const client = new ApiClient(options.fetchFn ?? failingFetch)
  const user = options.user === undefined ? fixtureAdmin : options.user
  return render(
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} env="test">
      <QueryClientProvider client={testQueryClient()}>
        <ApiContext.Provider value={client}>
          <SessionContext.Provider value={user}>
            <Notifications />
            <MemoryRouter initialEntries={[options.route ?? '/']}>{ui}</MemoryRouter>
          </SessionContext.Provider>
        </ApiContext.Provider>
      </QueryClientProvider>
    </MantineProvider>,
  )
}

/** Full-app render through the real route table (deep links, auth gate). */
export function renderApp(options: RenderOptions = {}): RenderResult {
  const client = new ApiClient(options.fetchFn ?? failingFetch)
  const router = createMemoryRouter(routes, { initialEntries: [options.route ?? '/'] })
  return render(
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} env="test">
      <QueryClientProvider client={testQueryClient()}>
        <ApiContext.Provider value={client}>
          <Notifications />
          <RouterProvider router={router} />
        </ApiContext.Provider>
      </QueryClientProvider>
    </MantineProvider>,
  )
}

const failingFetch: FetchLike = (input) =>
  Promise.reject(new Error(`unexpected fetch in test: ${input}`))

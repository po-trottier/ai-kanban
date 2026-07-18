import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import '@mantine/notifications/styles.css'
import '@mantine/tiptap/styles.css'
import './index.css'

import { ColorSchemeScript, MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { ApiContext } from './api/api-context.ts'
import { ApiClient } from './api/client.ts'
import { createAppQueryClient } from './api/query-client.ts'
import { routes } from './app/routes.tsx'
import { ErrorBoundary } from './shell/ErrorBoundary.tsx'
import { cssVariablesResolver, theme } from './theme.ts'

const queryClient = createAppQueryClient()
const apiClient = new ApiClient()
const router = createBrowserRouter(routes)

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      {/* Sets data-mantine-color-scheme before first paint (no FOUC); `auto`
          follows prefers-color-scheme until the signed-in user's theme applies. */}
      <ColorSchemeScript defaultColorScheme="auto" />
      <MantineProvider
        theme={theme}
        cssVariablesResolver={cssVariablesResolver}
        defaultColorScheme="auto"
      >
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <ApiContext.Provider value={apiClient}>
              <Notifications position="top-right" />
              <RouterProvider router={router} />
            </ApiContext.Provider>
          </QueryClientProvider>
        </ErrorBoundary>
      </MantineProvider>
    </StrictMode>,
  )
}

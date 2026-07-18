import { Alert, Button, Center, Stack, Tooltip } from '@mantine/core'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { strings } from '../strings.ts'

interface ErrorBoundaryState {
  hasError: boolean
}

/** Last-resort boundary: render errors show a reload prompt, never a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  override componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {
    // Intentionally silent: no console (lint rule); errors surface in the UI.
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children
    return (
      <Center h="100vh">
        <Stack align="center" gap="md">
          <Alert color="red" title={strings.common.genericError} />
          <Tooltip label={strings.tooltips.reload}>
            <Button
              onClick={() => {
                window.location.reload()
              }}
            >
              {strings.common.reload}
            </Button>
          </Tooltip>
        </Stack>
      </Center>
    )
  }
}

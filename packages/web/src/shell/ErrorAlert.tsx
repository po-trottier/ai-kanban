import { Alert, List, Text } from '@mantine/core'
import { isApiError } from '../api/problem.ts'
import { strings } from '../strings.ts'

export interface ErrorAlertProps {
  error: unknown
  fallbackMessage?: string
}

/** Renders problem+json errors faithfully: title, detail, validation issues. */
export function ErrorAlert({ error, fallbackMessage }: ErrorAlertProps) {
  if (isApiError(error)) {
    const { problem } = error
    return (
      <Alert color="red" title={problem.title ?? fallbackMessage ?? strings.common.genericError}>
        {problem.detail !== undefined ? <Text size="sm">{problem.detail}</Text> : null}
        {problem.issues !== undefined && problem.issues.length > 0 ? (
          <>
            <Text size="sm" mt="xs">
              {strings.common.validationIssues}
            </Text>
            <List size="sm">
              {problem.issues.map((issue) => (
                <List.Item key={`${issue.path.join('.')}:${issue.message}`}>
                  {issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''}
                  {issue.message}
                </List.Item>
              ))}
            </List>
          </>
        ) : null}
      </Alert>
    )
  }
  return (
    <Alert color="red" title={fallbackMessage ?? strings.common.genericError}>
      {error instanceof Error ? <Text size="sm">{error.message}</Text> : null}
    </Alert>
  )
}

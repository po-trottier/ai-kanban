import { Button, Group } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { Undo2 } from 'lucide-react'
import { type ReactNode } from 'react'
import { strings } from '../strings.ts'

/**
 * A Gmail-style undoable-action toast: confirms a reversible action (cancel,
 * archive, block …) and offers an **Undo** button for a beat. Clicking Undo hides
 * the toast and runs `onUndo` (the inverse mutation). A neutral (not green) toast
 * so it reads as "done — reversible", with a longer window than a plain success.
 * Its own `.tsx` file because the Undo `Button` is JSX (Mantine's polymorphic
 * button doesn't type-check through `createElement`).
 */
export function notifyUndoable(message: ReactNode, onUndo: () => void): void {
  const id = `undoable-${crypto.randomUUID()}`
  notifications.show({
    id,
    withBorder: true,
    autoClose: 8000,
    message: (
      <Group justify="space-between" wrap="nowrap" gap="md">
        {message}
        <Button
          variant="subtle"
          size="compact-sm"
          leftSection={<Undo2 size={14} aria-hidden />}
          onClick={() => {
            notifications.hide(id)
            onUndo()
          }}
        >
          {strings.common.undo}
        </Button>
      </Group>
    ),
  })
}

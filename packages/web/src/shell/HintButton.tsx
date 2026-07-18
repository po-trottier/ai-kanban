import { Button, Tooltip, type ButtonProps } from '@mantine/core'
import { type MouseEvent, type MouseEventHandler, type ReactNode } from 'react'

export interface HintButtonProps extends ButtonProps {
  /** The always-shown tooltip: the button's purpose/context (never a bare echo
   *  of the label). Include the keyboard shortcut where one exists. */
  tooltip: ReactNode
  /**
   * When set to a non-empty string, the button is shown disabled AND the
   * tooltip explains WHY. Uses Mantine's `data-disabled` pattern rather than
   * the native `disabled` prop: a natively-disabled button fires no hover
   * events, so its Tooltip would never appear (mantine.dev/core/button —
   * "Disabled button with tooltip"). The click is guarded so the
   * visually-disabled button still can't act.
   */
  disabledReason?: string | false | undefined
  type?: 'button' | 'submit'
  onClick?: MouseEventHandler<HTMLButtonElement>
  'aria-label'?: string
  children?: ReactNode
}

/**
 * A Mantine `Button` that ALWAYS carries a Tooltip — the helpful hint when
 * enabled, or the reason it's disabled when `disabledReason` is set. Centralizes
 * the `data-disabled` gotcha (a real `disabled` button can't show a tooltip) so
 * every call site gets a hover/focus-visible reason for free.
 */
export function HintButton({
  tooltip,
  disabledReason,
  onClick,
  children,
  ...buttonProps
}: HintButtonProps) {
  const disabled = typeof disabledReason === 'string' && disabledReason !== ''
  return (
    <Tooltip label={disabled ? disabledReason : tooltip} withArrow multiline>
      <Button
        {...buttonProps}
        {...(disabled
          ? {
              'data-disabled': true,
              onClick: (event: MouseEvent<HTMLButtonElement>) => {
                event.preventDefault()
              },
            }
          : { onClick })}
      >
        {children}
      </Button>
    </Tooltip>
  )
}

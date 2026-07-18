import { ActionIcon, Group, Tooltip } from '@mantine/core'
import { Info } from 'lucide-react'
import { type ReactNode } from 'react'

export interface FieldLabelProps {
  /** The visible field label text. */
  label: ReactNode
  /** Plain-language explanation shown on the info icon's tooltip. */
  help: string
}

/**
 * A form-field label with a trailing lucide `Info` glyph whose Tooltip explains
 * the field (what P0/P1/P2 mean, what "estimate" measures, etc.). The one
 * consistent pattern for field help across the card and settings forms — pass
 * it as a Mantine input's `label` prop. The icon carries the help text as its
 * accessible name so keyboard/AT users reach the same explanation.
 */
export function FieldLabel({ label, help }: FieldLabelProps) {
  return (
    <Group gap={4} wrap="nowrap" component="span">
      {label}
      <Tooltip label={help} withArrow multiline w={240}>
        <ActionIcon variant="transparent" color="gray" size="xs" aria-label={help}>
          <Info size={14} aria-hidden />
        </ActionIcon>
      </Tooltip>
    </Group>
  )
}

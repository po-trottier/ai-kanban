import { type LocationKind } from '@rivian-kanban/core'
import { ThemeIcon } from '@mantine/core'
import { Building2, DoorClosed, Layers } from 'lucide-react'

/**
 * A kind badge for a location node — building / floor / room — so the tree
 * reads at a glance for non-technical users. Colors and sizes come from the
 * Mantine theme (ADR-016 tokens); the glyphs are lucide-react icons.
 */
const KIND_ICON: Record<LocationKind, typeof Building2> = {
  building: Building2,
  floor: Layers,
  room: DoorClosed,
}

const KIND_COLOR: Record<LocationKind, string> = {
  building: 'indigo',
  floor: 'cyan',
  room: 'teal',
}

export function LocationKindIcon({ kind }: { kind: LocationKind }) {
  const Icon = KIND_ICON[kind]
  return (
    <ThemeIcon size="md" radius="sm" variant="light" color={KIND_COLOR[kind]}>
      <Icon size="70%" aria-hidden />
    </ThemeIcon>
  )
}

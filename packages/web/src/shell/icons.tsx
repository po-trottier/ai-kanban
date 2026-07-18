import { MapPin, MoreHorizontal, Search, X } from 'lucide-react'

/**
 * The app's named icon aliases — thin wrappers over lucide-react (the project's
 * icon library; Mantine ships none — see mantine.dev/core/action-icon). Call
 * sites share one vocabulary and a consistent default size + `aria-hidden`
 * (icons here are decorative — the enclosing ActionIcon/button carries the
 * accessible name). No hand-rolled SVG paths (ADR-016).
 */

interface IconProps {
  size?: number
}

const DEFAULT_SIZE = 18

/** A horizontal "more actions" (⋯) icon. */
export function DotsIcon({ size = DEFAULT_SIZE }: IconProps) {
  return <MoreHorizontal size={size} aria-hidden />
}

/** A close (✕) icon. */
export function CloseIcon({ size = DEFAULT_SIZE }: IconProps) {
  return <X size={size} aria-hidden />
}

/** A magnifying-glass (search) icon. */
export function SearchIcon({ size = DEFAULT_SIZE }: IconProps) {
  return <Search size={size} aria-hidden />
}

/** A map-pin glyph for card location lines (board card + search result rows). */
export function PinIcon({ size = DEFAULT_SIZE }: IconProps) {
  return <MapPin size={size} aria-hidden />
}

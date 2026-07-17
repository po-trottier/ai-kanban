import { type Location } from '@rivian-kanban/core'
import { TreeSelect } from '@mantine/core'
import { buildLocationTree, type LocationTreeNode } from '../lib/location-tree.ts'
import { strings } from '../strings.ts'

export interface LocationPickerProps {
  locations: Location[]
  value: string | null
  disabled?: boolean
  onChange: (locationId: string | null) => void
  error?: string
  /** Overrides the default "Location" field label (e.g. the search filter row). */
  label?: string
  /** Placeholder shown when nothing is selected (e.g. "Any location"). */
  placeholder?: string
}

/** Site-tree picker (building/floor/room) backed by Mantine's keyboard-navigable tree. */
export function LocationPicker({
  locations,
  value,
  disabled = false,
  onChange,
  error,
  label,
  placeholder,
}: LocationPickerProps) {
  const data = buildLocationTree(locations).map(toTreeNode)
  return (
    <TreeSelect
      label={label ?? strings.detail.locationLabel}
      data={data}
      value={value}
      onChange={onChange}
      clearable
      defaultExpandAll
      disabled={disabled}
      {...(placeholder === undefined ? {} : { placeholder })}
      {...(error === undefined ? {} : { error })}
    />
  )
}

function toTreeNode(node: LocationTreeNode): {
  value: string
  label: string
  children?: ReturnType<typeof toTreeNode>[]
} {
  return {
    value: node.value,
    label: node.label,
    ...(node.children.length > 0 ? { children: node.children.map(toTreeNode) } : {}),
  }
}

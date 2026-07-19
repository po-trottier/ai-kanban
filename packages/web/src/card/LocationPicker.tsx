import { type Location } from '@rivian-kanban/core'
import { Anchor, TextInput, TreeSelect } from '@mantine/core'
import { Link } from 'react-router'
import { buildLocationTree, type LocationTreeNode } from '../lib/location-tree.ts'
import { FieldLabel } from '../shell/FieldLabel.tsx'
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
  // The card form (no label override) gets the explanatory info tooltip; the
  // search filter passes its own plain "Location" label.
  const fieldLabel = label ?? (
    <FieldLabel label={strings.detail.locationLabel} help={strings.fieldHelp.location} />
  )
  // No locations exist yet: a tiny empty combobox is confusing — say so clearly
  // and point admins to Settings instead of offering an empty picker.
  if (data.length === 0) {
    return (
      <TextInput
        label={fieldLabel}
        placeholder={strings.detail.noLocations}
        description={
          <>
            {strings.detail.noLocationsHint}{' '}
            <Anchor component={Link} to="/settings">
              {strings.detail.noLocationsSettingsLink}
            </Anchor>
          </>
        }
        disabled
        readOnly
      />
    )
  }
  return (
    <TreeSelect
      label={fieldLabel}
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

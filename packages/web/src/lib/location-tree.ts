import { type Location } from '@rivian-kanban/core'

export interface LocationTreeNode {
  value: string
  label: string
  location: Location
  children: LocationTreeNode[]
}

/** Builds the building → floor → room tree from the flat `GET /locations` list. */
export function buildLocationTree(locations: Location[]): LocationTreeNode[] {
  const byParent = new Map<string | null, Location[]>()
  for (const location of locations) {
    const siblings = byParent.get(location.parentId) ?? []
    siblings.push(location)
    byParent.set(location.parentId, siblings)
  }
  const toNode = (location: Location): LocationTreeNode => ({
    value: location.id,
    label: location.name,
    location,
    children: (byParent.get(location.id) ?? [])
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map(toNode),
  })
  return (byParent.get(null) ?? []).toSorted((a, b) => a.name.localeCompare(b.name)).map(toNode)
}

/** Human-readable path for a location id ("Building 2 / Floor 1 / Room 4"). */
export function locationPath(locations: Location[], locationId: string): string {
  const byId = new Map(locations.map((location) => [location.id, location]))
  const parts: string[] = []
  let current = byId.get(locationId)
  while (current !== undefined) {
    parts.unshift(current.name)
    current = current.parentId === null ? undefined : byId.get(current.parentId)
  }
  return parts.join(' / ')
}

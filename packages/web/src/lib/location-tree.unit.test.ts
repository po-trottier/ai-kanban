import { type Location } from '@rivian-kanban/core'
import { describe, expect, it } from 'vitest'
import { uid } from '../test/fixtures.ts'
import { buildLocationTree, locationPath } from './location-tree.ts'

const building: Location = { id: uid(31), parentId: null, kind: 'building', name: 'HQ' }
const floor: Location = { id: uid(32), parentId: building.id, kind: 'floor', name: 'Floor 2' }
const room: Location = { id: uid(33), parentId: floor.id, kind: 'room', name: 'Room 204' }
const annex: Location = { id: uid(34), parentId: null, kind: 'building', name: 'Annex' }

describe('buildLocationTree', () => {
  it('nests floors under buildings and rooms under floors, sorted by name', () => {
    // Arrange
    const flat = [room, building, annex, floor]
    // Act
    const tree = buildLocationTree(flat)
    // Assert
    expect(tree.map((node) => node.label)).toEqual(['Annex', 'HQ'])
    expect(tree[1]?.children.map((node) => node.label)).toEqual(['Floor 2'])
    expect(tree[1]?.children[0]?.children.map((node) => node.label)).toEqual(['Room 204'])
  })
})

describe('locationPath', () => {
  it('joins ancestor names root-first', () => {
    // Arrange
    const flat = [building, floor, room]
    // Act
    const path = locationPath(flat, room.id)
    // Assert
    expect(path).toBe('HQ / Floor 2 / Room 204')
  })
})

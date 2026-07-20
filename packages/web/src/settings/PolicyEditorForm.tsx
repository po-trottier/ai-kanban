import { type Permission, type PolicyDocument, type RoleDefinition } from '@rivian-kanban/core'
import {
  ActionIcon,
  Badge,
  Checkbox,
  Group,
  Menu,
  Modal,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { Plus, Save, X } from 'lucide-react'
import { useState } from 'react'
import { strings } from '../strings.ts'
import { FieldLabel } from '../shell/FieldLabel.tsx'
import { HintButton } from '../shell/HintButton.tsx'
import { DotsIcon } from '../shell/icons.tsx'
import classes from './policy-editor.module.css'

export interface PolicyEditorFormProps {
  value: PolicyDocument
  laneLabels: Partial<Record<string, string>>
  saving: boolean
  /** Set when the last save failed with the server 409 role-in-use conflict. */
  roleInUseError?: boolean
  onSave: (document: PolicyDocument) => void
}

/** The permission rows, grouped into admin-legible sections (ADR-013). */
const PERMISSION_SECTIONS: { section: keyof typeof strings.policy.sections; rows: Permission[] }[] =
  [
    {
      section: 'cards',
      rows: [
        'card.create',
        'card.update',
        'card.move',
        'card.block',
        'card.unblock',
        'card.cancel',
        'card.reopen',
        'card.archive',
      ],
    },
    {
      section: 'commentsFiles',
      rows: ['comment.add', 'comment.deleteOthers', 'attachment.add', 'attachment.deleteOthers'],
    },
    {
      section: 'administration',
      rows: [
        'manageUsers',
        'manageRoles',
        'manageLocations',
        'manageLanes',
        'managePolicy',
        'manageTokens',
      ],
    },
  ]

const ROLE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/

/** How many roles currently grant manageRoles — the last one can't lose it. */
function manageRolesCount(roles: RoleDefinition[]): number {
  return roles.filter((role) => role.permissions.manageRoles === true).length
}

/**
 * The roles × permissions matrix editor (ADR-013): a sticky first column of
 * permission labels grouped into sections, one column per role with a
 * rename/delete menu, an "Add role" column, a checkbox per (role, permission)
 * cell, the enforcement toggle, and an editable from×to workflow matrix (one
 * checkbox per allowed move over the live board columns). Saving PUTs a whole
 * new policy version.
 */
export function PolicyEditorForm({
  value,
  laneLabels,
  saving,
  roleInUseError,
  onSave,
}: PolicyEditorFormProps) {
  const [document, setDocument] = useState<PolicyDocument>(value)
  const [addOpen, setAddOpen] = useState(false)
  const [renaming, setRenaming] = useState<number | null>(null)

  const laneLabel = (key: string): string => laneLabels[key] ?? key

  const toggleCell = (roleIndex: number, permission: Permission, checked: boolean) => {
    setDocument((current) => ({
      ...current,
      roles: current.roles.map((role, at) => {
        if (at !== roleIndex) return role
        // Rebuild the sparse grant map: presence = granted (never store `false`).
        const permissions = Object.fromEntries(
          Object.entries(role.permissions).filter(([key]) => key !== permission),
        )
        if (checked) permissions[permission] = true
        return { ...role, permissions }
      }),
    }))
  }

  const addRole = (key: string, name: string) => {
    setDocument((current) => ({
      ...current,
      roles: [...current.roles, { key, name, permissions: {} }],
    }))
  }

  const renameRole = (roleIndex: number, name: string) => {
    setDocument((current) => ({
      ...current,
      roles: current.roles.map((role, at) => (at === roleIndex ? { ...role, name } : role)),
    }))
  }

  const deleteRole = (roleIndex: number) => {
    setDocument((current) => ({
      ...current,
      roles: current.roles.filter((_, at) => at !== roleIndex),
    }))
  }

  // Toggle a from→to workflow edge (mirrors toggleCell: presence = allowed).
  const toggleEdge = (from: string, to: string, checked: boolean) => {
    setDocument((current) => ({
      ...current,
      transitions: checked
        ? [...current.transitions, { from, to }]
        : current.transitions.filter((edge) => !(edge.from === from && edge.to === to)),
    }))
  }

  const removeEdge = (from: string, to: string) => {
    toggleEdge(from, to, false)
  }

  // Guardrail: manageRoles can't be unticked on the last role that has it, or
  // nobody could ever edit permissions again (the schema enforces this too).
  const manageRolesLocked = (roleIndex: number, permission: Permission): boolean =>
    permission === 'manageRoles' &&
    document.roles[roleIndex]?.permissions.manageRoles === true &&
    manageRolesCount(document.roles) === 1

  // A role can be deleted only if it isn't the last manageRoles holder and more
  // than one role remains (min 1 by schema).
  const canDeleteRole = (roleIndex: number): boolean => {
    if (document.roles.length <= 1) return false
    const role = document.roles[roleIndex]
    if (role?.permissions.manageRoles === true && manageRolesCount(document.roles) === 1) {
      return false
    }
    return true
  }

  // The live board columns, in board order (SettingsPage builds laneLabels from
  // the ordered lane snapshots). The matrix is a from×to grid over these.
  const laneKeys = Object.keys(laneLabels)
  const liveLanes = new Set(laneKeys)
  const edgeSet = new Set(document.transitions.map((edge) => `${edge.from}->${edge.to}`))
  const hasEdge = (from: string, to: string): boolean => edgeSet.has(`${from}->${to}`)
  // Edges pointing at a column that no longer exists (backend prunes on delete,
  // but stay robust): shown as removable chips below the matrix so nothing hides.
  const staleEdges = document.transitions.filter(
    (edge) => !liveLanes.has(edge.from) || !liveLanes.has(edge.to),
  )
  // Advisory only: live columns with no outgoing edge to another live column —
  // a card entering them can never leave once enforcement is on.
  const unreachableForward = laneKeys.filter(
    (from) => !document.transitions.some((edge) => edge.from === from && liveLanes.has(edge.to)),
  )

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Title order={3} size="sm">
          {strings.policy.matrixTitle}
        </Title>
        <Text size="xs" c="dimmed">
          {strings.policy.matrixHint}
        </Text>
        {roleInUseError ? (
          <Text size="xs" c="red">
            {strings.policy.roleInUse}
          </Text>
        ) : null}
        <Table withTableBorder stickyHeader aria-label={strings.policy.matrixLabel}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ position: 'sticky', left: 0 }}>
                <FieldLabel
                  label={strings.policy.permissionColumnHeader}
                  help={strings.fieldHelp.permissionCell}
                />
              </Table.Th>
              {document.roles.map((role, roleIndex) => (
                <Table.Th key={role.key} className={classes.roleColumn}>
                  {/* Name + its "…" menu sit together in one cluster (the menu
                      right after the name), so the control reads as belonging to
                      the role rather than floating at the column's far edge. */}
                  <Group gap="xs" wrap="nowrap">
                    <Text size="sm" fw={600}>
                      {role.name}
                    </Text>
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target>
                        <Tooltip label={strings.policy.roleMenuLabel(role.name)}>
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            color="gray"
                            aria-label={strings.policy.roleMenuLabel(role.name)}
                          >
                            <DotsIcon size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Tooltip label={strings.tooltips.renameRole} position="left" withArrow>
                          <Menu.Item
                            onClick={() => {
                              setRenaming(roleIndex)
                            }}
                          >
                            {strings.policy.renameRole}
                          </Menu.Item>
                        </Tooltip>
                        {/* Disabled Menu.Item keeps `data-disabled` (hoverable),
                            so the "why you can't delete" reason still shows. */}
                        <Tooltip
                          label={
                            canDeleteRole(roleIndex)
                              ? strings.tooltips.deleteRole
                              : strings.tooltips.disabledDeleteRoleLast
                          }
                          position="left"
                          withArrow
                        >
                          <Menu.Item
                            color="red"
                            disabled={!canDeleteRole(roleIndex)}
                            onClick={() => {
                              deleteRole(roleIndex)
                            }}
                          >
                            {strings.policy.deleteRole}
                          </Menu.Item>
                        </Tooltip>
                      </Menu.Dropdown>
                    </Menu>
                  </Group>
                </Table.Th>
              ))}
              <Table.Th>
                {/* Right-align at content width so the button hugs the header's
                    right edge instead of filling this trailing column. */}
                <Group justify="flex-end">
                  <HintButton
                    tooltip={strings.tooltips.addRole}
                    size="sm"
                    variant="light"
                    leftSection={<Plus size={16} aria-hidden />}
                    onClick={() => {
                      setAddOpen(true)
                    }}
                  >
                    {strings.policy.addRole}
                  </HintButton>
                </Group>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {PERMISSION_SECTIONS.map(({ section, rows }) => (
              <SectionRows
                key={section}
                sectionLabel={strings.policy.sections[section]}
                permissions={rows}
                roles={document.roles}
                colSpan={document.roles.length + 2}
                onToggle={toggleCell}
                locked={manageRolesLocked}
              />
            ))}
          </Table.Tbody>
        </Table>
      </Stack>

      <Stack gap="sm">
        <Switch
          label={strings.policy.enforcementLabel}
          description={strings.policy.enforcementHint}
          checked={document.transitionEnforcement}
          onChange={(event) => {
            const checked = event.currentTarget.checked
            setDocument((current) => ({ ...current, transitionEnforcement: checked }))
          }}
        />
        <Stack gap="sm" opacity={document.transitionEnforcement ? 1 : 0.5}>
          <Title order={3} size="sm">
            {strings.policy.transitionsTitle}
          </Title>
          <Text size="xs" c="dimmed">
            {strings.policy.transitionsHint}
          </Text>
          {document.transitionEnforcement ? null : (
            <Text size="xs" c="dimmed">
              {strings.policy.disabledWhenOff}
            </Text>
          )}
          <Table withTableBorder aria-label={strings.policy.transitionsMatrixLabel}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ position: 'sticky', left: 0 }}>
                  <Text size="xs" fw={700} c="dimmed">
                    {strings.policy.transitionsFromHeader}
                  </Text>
                </Table.Th>
                {laneKeys.map((to) => (
                  <Table.Th key={to} scope="col">
                    <Text size="sm" fw={600}>
                      {laneLabel(to)}
                    </Text>
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {laneKeys.map((from) => (
                <Table.Tr key={from}>
                  <Table.Th scope="row" style={{ position: 'sticky', left: 0 }}>
                    <Text size="sm" fw={600}>
                      {laneLabel(from)}
                    </Text>
                  </Table.Th>
                  {laneKeys.map((to) =>
                    // No self-loops: the diagonal is empty and non-interactive.
                    from === to ? (
                      <Table.Td key={to} />
                    ) : (
                      <Table.Td key={to}>
                        <Checkbox
                          size="sm"
                          aria-label={strings.policy.edgeCellLabel(laneLabel(from), laneLabel(to))}
                          checked={hasEdge(from, to)}
                          onChange={(event) => {
                            toggleEdge(from, to, event.currentTarget.checked)
                          }}
                        />
                      </Table.Td>
                    ),
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {staleEdges.length > 0 ? (
            <Stack gap="xs">
              <Text size="xs" fw={700} tt="uppercase" c="dimmed">
                {strings.policy.staleEdgesTitle}
              </Text>
              <Group gap="xs">
                {staleEdges.map((edge) => {
                  const fromLabel = laneLabel(edge.from)
                  const toLabel = laneLabel(edge.to)
                  return (
                    <Badge
                      key={`${edge.from}->${edge.to}`}
                      variant="light"
                      color="gray"
                      rightSection={
                        <Tooltip label={strings.policy.staleEdgeRemove(fromLabel, toLabel)}>
                          <ActionIcon
                            size="xs"
                            variant="transparent"
                            color="gray"
                            aria-label={strings.policy.staleEdgeRemove(fromLabel, toLabel)}
                            onClick={() => {
                              removeEdge(edge.from, edge.to)
                            }}
                          >
                            <X size={12} aria-hidden />
                          </ActionIcon>
                        </Tooltip>
                      }
                    >
                      {strings.policy.staleEdgeLabel(fromLabel, toLabel)}
                    </Badge>
                  )
                })}
              </Group>
            </Stack>
          ) : null}
          {document.transitionEnforcement && unreachableForward.length > 0
            ? unreachableForward.map((from) => (
                <Text key={from} size="xs" c="orange">
                  {strings.policy.unreachableForward(laneLabel(from))}
                </Text>
              ))
            : null}
        </Stack>
      </Stack>

      <Group justify="flex-end">
        <HintButton
          tooltip={strings.tooltips.savePolicy}
          loading={saving}
          leftSection={<Save size={16} aria-hidden />}
          onClick={() => {
            onSave(document)
          }}
        >
          {strings.common.save}
        </HintButton>
      </Group>

      {addOpen ? (
        <AddRoleModal
          existingKeys={document.roles.map((role) => role.key)}
          onAdd={(key, name) => {
            addRole(key, name)
            setAddOpen(false)
          }}
          onClose={() => {
            setAddOpen(false)
          }}
        />
      ) : null}

      {renaming !== null && document.roles[renaming] !== undefined ? (
        <RenameRoleModal
          current={document.roles[renaming].name}
          onRename={(name) => {
            renameRole(renaming, name)
            setRenaming(null)
          }}
          onClose={() => {
            setRenaming(null)
          }}
        />
      ) : null}
    </Stack>
  )
}

/** A section header row plus one checkbox row per permission in the section. */
function SectionRows({
  sectionLabel,
  permissions,
  roles,
  colSpan,
  onToggle,
  locked,
}: {
  sectionLabel: string
  permissions: Permission[]
  roles: RoleDefinition[]
  colSpan: number
  onToggle: (roleIndex: number, permission: Permission, checked: boolean) => void
  locked: (roleIndex: number, permission: Permission) => boolean
}) {
  return (
    <>
      <Table.Tr>
        <Table.Th colSpan={colSpan}>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed">
            {sectionLabel}
          </Text>
        </Table.Th>
      </Table.Tr>
      {permissions.map((permission) => (
        <Table.Tr key={permission}>
          <Table.Td style={{ position: 'sticky', left: 0 }}>
            <Text size="sm">{strings.policy.permissions[permission]}</Text>
          </Table.Td>
          {roles.map((role, roleIndex) => (
            <Table.Td key={role.key}>
              <Checkbox
                size="sm"
                aria-label={strings.policy.cellLabel(
                  role.name,
                  strings.policy.permissions[permission],
                )}
                checked={role.permissions[permission] === true}
                disabled={locked(roleIndex, permission)}
                onChange={(event) => {
                  onToggle(roleIndex, permission, event.currentTarget.checked)
                }}
              />
            </Table.Td>
          ))}
          <Table.Td />
        </Table.Tr>
      ))}
    </>
  )
}

function AddRoleModal({
  existingKeys,
  onAdd,
  onClose,
}: {
  existingKeys: string[]
  onAdd: (key: string, name: string) => void
  onClose: () => void
}) {
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const keyInvalid = key !== '' && !ROLE_KEY_PATTERN.test(key)
  const keyTaken = existingKeys.includes(key)
  const canSubmit = key !== '' && name.trim() !== '' && !keyInvalid && !keyTaken

  return (
    <Modal opened onClose={onClose} title={strings.policy.addRoleTitle} centered>
      <Stack gap="md">
        <TextInput
          label={strings.policy.roleKeyLabel}
          description={strings.policy.roleKeyHint}
          data-autofocus
          value={key}
          error={
            keyInvalid
              ? strings.policy.roleKeyInvalid
              : keyTaken
                ? strings.policy.roleKeyTaken
                : null
          }
          onChange={(event) => {
            setKey(event.currentTarget.value)
          }}
        />
        <TextInput
          label={strings.policy.roleNameLabel}
          description={strings.fieldHelp.roleName}
          value={name}
          onChange={(event) => {
            setName(event.currentTarget.value)
          }}
        />
        <Group justify="flex-end">
          <HintButton tooltip={strings.tooltips.cancelDialog} variant="default" onClick={onClose}>
            {strings.common.cancel}
          </HintButton>
          <HintButton
            tooltip={strings.tooltips.createRole}
            disabledReason={!canSubmit ? strings.tooltips.disabledRoleFields : undefined}
            leftSection={<Plus size={16} aria-hidden />}
            onClick={() => {
              onAdd(key, name.trim())
            }}
          >
            {strings.common.create}
          </HintButton>
        </Group>
      </Stack>
    </Modal>
  )
}

function RenameRoleModal({
  current,
  onRename,
  onClose,
}: {
  current: string
  onRename: (name: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(current)
  return (
    <Modal opened onClose={onClose} title={strings.policy.renameRoleTitle} centered>
      <Stack gap="md">
        <TextInput
          label={strings.policy.roleNameLabel}
          description={strings.fieldHelp.roleName}
          data-autofocus
          value={name}
          error={name.trim() === '' ? strings.policy.roleNameRequired : null}
          onChange={(event) => {
            setName(event.currentTarget.value)
          }}
        />
        <Group justify="flex-end">
          <HintButton tooltip={strings.tooltips.cancelDialog} variant="default" onClick={onClose}>
            {strings.common.cancel}
          </HintButton>
          <HintButton
            tooltip={strings.tooltips.renameRole}
            disabledReason={
              name.trim() === '' ? strings.tooltips.disabledRoleNameRequired : undefined
            }
            leftSection={<Save size={16} aria-hidden />}
            onClick={() => {
              onRename(name.trim())
            }}
          >
            {strings.common.save}
          </HintButton>
        </Group>
      </Stack>
    </Modal>
  )
}

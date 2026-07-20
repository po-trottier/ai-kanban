import { type Permission, type PolicyDocument, type RoleDefinition } from '@rivian-kanban/core'
import {
  ActionIcon,
  Checkbox,
  Group,
  Menu,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { Plus, Save } from 'lucide-react'
import { useState } from 'react'
import { strings } from '../strings.ts'
import { FieldLabel } from '../shell/FieldLabel.tsx'
import { HintButton } from '../shell/HintButton.tsx'
import { DotsIcon } from '../shell/icons.tsx'
import classes from './policy-editor.module.css'

export interface PolicyEditorFormProps {
  value: PolicyDocument
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
 * rename/delete menu, an "Add role" column, and a checkbox per (role,
 * permission) cell. Saving PUTs a whole new policy version (carrying the
 * workflow transitions through untouched — those are edited on the Columns tab).
 */
export function PolicyEditorForm({ value, saving, roleInUseError, onSave }: PolicyEditorFormProps) {
  const [document, setDocument] = useState<PolicyDocument>(value)
  const [addOpen, setAddOpen] = useState(false)
  const [renaming, setRenaming] = useState<number | null>(null)

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

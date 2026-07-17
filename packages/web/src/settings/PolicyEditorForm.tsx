import { ROLES, type PolicyActionGates, type PolicyDocument, type Role } from '@rivian-kanban/core'
import { Button, Group, Select, Stack, Switch, Table, Text, Title } from '@mantine/core'
import { useState } from 'react'
import { strings } from '../strings.ts'

export interface PolicyEditorFormProps {
  value: PolicyDocument
  laneLabels: Partial<Record<string, string>>
  saving: boolean
  onSave: (document: PolicyDocument) => void
}

const NO_GATE = ''

/**
 * The permission policy editor (ADR-013): enforcement toggle, per-transition
 * minRole on the seeded graph, and the five action gates. Saving PUTs a whole
 * new policy version.
 */
export function PolicyEditorForm({ value, laneLabels, saving, onSave }: PolicyEditorFormProps) {
  const [document, setDocument] = useState<PolicyDocument>(value)

  const laneLabel = (key: string): string => laneLabels[key] ?? key

  const roleOptions = [
    { value: NO_GATE, label: strings.policy.anyRole },
    ...ROLES.map((role) => ({ value: role, label: strings.users.roles[role] })),
  ]

  const setTransitionRole = (index: number, minRole: Role | null) => {
    setDocument((current) => ({
      ...current,
      transitions: current.transitions.map((edge, at) =>
        at === index
          ? { from: edge.from, to: edge.to, ...(minRole === null ? {} : { minRole }) }
          : edge,
      ),
    }))
  }

  const setGate = (gate: keyof PolicyActionGates, role: Role | null) => {
    setDocument((current) => {
      const gates = Object.fromEntries(
        Object.entries(current.actionGates).filter(([key]) => key !== gate),
      ) as PolicyActionGates
      if (role !== null) gates[gate] = role
      return { ...current, actionGates: gates }
    })
  }

  return (
    <Stack gap="lg">
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
        <Table>
          <Table.Tbody>
            {document.transitions.map((edge, index) => (
              <Table.Tr key={`${edge.from}->${edge.to}`}>
                <Table.Td>
                  <Text size="sm">
                    {strings.policy.transitionRowLabel(laneLabel(edge.from), laneLabel(edge.to))}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Select
                    aria-label={`${strings.policy.minRoleLabel}: ${strings.policy.transitionRowLabel(
                      laneLabel(edge.from),
                      laneLabel(edge.to),
                    )}`}
                    size="xs"
                    data={roleOptions}
                    value={edge.minRole ?? NO_GATE}
                    allowDeselect={false}
                    disabled={!document.transitionEnforcement}
                    onChange={(selected) => {
                      setTransitionRole(index, selected === NO_GATE ? null : (selected as Role))
                    }}
                  />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Stack>
      <Stack gap="sm" opacity={document.transitionEnforcement ? 1 : 0.5}>
        <Title order={3} size="sm">
          {strings.policy.actionGatesTitle}
        </Title>
        <Text size="xs" c="dimmed">
          {strings.policy.actionGatesHint}
        </Text>
        {(Object.keys(strings.policy.gates) as (keyof PolicyActionGates)[]).map((gate) => (
          <Select
            key={gate}
            label={strings.policy.gates[gate]}
            size="xs"
            data={roleOptions}
            value={document.actionGates[gate] ?? NO_GATE}
            allowDeselect={false}
            disabled={!document.transitionEnforcement}
            onChange={(selected) => {
              setGate(gate, selected === NO_GATE ? null : (selected as Role))
            }}
          />
        ))}
      </Stack>
      <Group justify="flex-end">
        <Button
          loading={saving}
          onClick={() => {
            onSave(document)
          }}
        >
          {strings.common.save}
        </Button>
      </Group>
    </Stack>
  )
}

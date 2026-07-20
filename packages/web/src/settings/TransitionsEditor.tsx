import { type PolicyDocument } from '@rivian-kanban/core'
import {
  ActionIcon,
  Badge,
  Checkbox,
  Group,
  Stack,
  Switch,
  Table,
  Text,
  Tooltip,
} from '@mantine/core'
import { Save, X } from 'lucide-react'
import { useState } from 'react'
import { usePutPolicy } from '../api/admin.ts'
import { useBoard } from '../api/board.ts'
import { usePolicy } from '../api/meta.ts'
import { FieldLabel } from '../shell/FieldLabel.tsx'
import { HintButton } from '../shell/HintButton.tsx'
import { SkeletonRows } from '../shell/SkeletonRows.tsx'
import { strings } from '../strings.ts'
import classes from './lanes.module.css'

/**
 * The workflow-transitions editor, mounted on the Columns tab beneath the column
 * list (ADR-013) so a board's columns and the moves allowed between them are set
 * in one place. A from×to matrix over the board's LIVE columns: ticking a cell
 * allows moving a work order from its ROW column to its COLUMN column. The
 * diagonal (a column → itself) is a fixed, disabled-checked cell — a work order
 * trivially stays put — so every cell carries a clear control. Saving PUTs a
 * whole new policy version, carrying `roles` through untouched (the Permissions
 * tab owns those).
 *
 * Self-fetches like the other Columns/Settings admins; remounts on each policy
 * refetch (own save or an SSE policy.updated) via the loaded snapshot's
 * `dataUpdatedAt` key, so the editor never PUTs a stale document.
 */
export function TransitionsEditor() {
  const policy = usePolicy()
  const board = useBoard()
  const laneLabels: Partial<Record<string, string>> = Object.fromEntries(
    (board.data?.lanes ?? []).map((snapshot) => [snapshot.lane.key, snapshot.lane.label]),
  )

  if (policy.data === undefined) {
    return (
      <Table>
        <Table.Tbody>
          <SkeletonRows rows={4} cols={4} />
        </Table.Tbody>
      </Table>
    )
  }

  return (
    <TransitionsForm
      // Re-seed the draft on every policy refetch so a save never PUTs over
      // someone else's concurrent change (mirrors SettingsPage's policy key).
      key={policy.dataUpdatedAt}
      value={policy.data}
      laneLabels={laneLabels}
    />
  )
}

interface TransitionsFormProps {
  value: PolicyDocument
  laneLabels: Partial<Record<string, string>>
}

function TransitionsForm({ value, laneLabels }: TransitionsFormProps) {
  const putPolicy = usePutPolicy()
  const [document, setDocument] = useState<PolicyDocument>(value)

  const laneLabel = (key: string): string => laneLabels[key] ?? key

  // Toggle a from→to edge (presence = allowed; never store the diagonal).
  const toggleEdge = (from: string, to: string, checked: boolean) => {
    setDocument((current) => ({
      ...current,
      transitions: checked
        ? [...current.transitions, { from, to }]
        : current.transitions.filter((edge) => !(edge.from === from && edge.to === to)),
    }))
  }

  // The live board columns, in board order. The matrix is a from×to grid over
  // these; the corner + row headers label the axes.
  const laneKeys = Object.keys(laneLabels)
  const liveLanes = new Set(laneKeys)
  const edgeSet = new Set(document.transitions.map((edge) => `${edge.from}->${edge.to}`))
  const hasEdge = (from: string, to: string): boolean => edgeSet.has(`${from}->${to}`)
  // Edges pointing at a column that no longer exists (backend prunes on delete,
  // but stay robust): removable chips below the matrix so nothing hides.
  const staleEdges = document.transitions.filter(
    (edge) => !liveLanes.has(edge.from) || !liveLanes.has(edge.to),
  )
  // Advisory only: live columns with no outgoing edge to another live column —
  // a card entering them can never leave once enforcement is on.
  const unreachableForward = laneKeys.filter(
    (from) => !document.transitions.some((edge) => edge.from === from && liveLanes.has(edge.to)),
  )

  return (
    <Stack gap="md">
      <Switch
        label={strings.transitions.enforcementLabel}
        description={strings.transitions.enforcementHint}
        checked={document.transitionEnforcement}
        onChange={(event) => {
          const checked = event.currentTarget.checked
          setDocument((current) => ({ ...current, transitionEnforcement: checked }))
        }}
      />
      <Stack gap="sm" opacity={document.transitionEnforcement ? 1 : 0.5}>
        <FieldLabel label={strings.transitions.title} help={strings.transitions.intro} />
        {document.transitionEnforcement ? null : (
          <Text size="xs" c="dimmed">
            {strings.transitions.disabledWhenOff}
          </Text>
        )}
        <Table
          withTableBorder
          className={classes.transitionsTable}
          aria-label={strings.transitions.matrixLabel}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th className={classes.fromColumn}>
                <Text size="xs" fw={700} c="dimmed">
                  {strings.transitions.axisCorner}
                </Text>
              </Table.Th>
              {laneKeys.map((to) => (
                <Table.Th key={to} scope="col">
                  <Text size="sm" fw={600} className={classes.laneHeadLabel} title={laneLabel(to)}>
                    {laneLabel(to)}
                  </Text>
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {laneKeys.map((from) => (
              <Table.Tr key={from}>
                <Table.Th scope="row" className={classes.fromColumn}>
                  <Text
                    size="sm"
                    fw={600}
                    className={classes.laneHeadLabel}
                    title={laneLabel(from)}
                  >
                    {laneLabel(from)}
                  </Text>
                </Table.Th>
                {laneKeys.map((to) => (
                  <Table.Td key={to} className={classes.transitionCell}>
                    {from === to ? (
                      // A work order trivially "stays" in its own column: a
                      // disabled, checked cell so the diagonal never reads as a
                      // broken/missing control (the policy never stores it).
                      <Checkbox
                        size="sm"
                        checked
                        disabled
                        readOnly
                        aria-label={strings.transitions.identityCellLabel(laneLabel(from))}
                      />
                    ) : (
                      <Checkbox
                        size="sm"
                        aria-label={strings.transitions.edgeCellLabel(
                          laneLabel(from),
                          laneLabel(to),
                        )}
                        checked={hasEdge(from, to)}
                        onChange={(event) => {
                          toggleEdge(from, to, event.currentTarget.checked)
                        }}
                      />
                    )}
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {staleEdges.length > 0 ? (
          <Stack gap="xs">
            <Text size="xs" fw={700} tt="uppercase" c="dimmed">
              {strings.transitions.staleEdgesTitle}
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
                      <Tooltip label={strings.transitions.staleEdgeRemove(fromLabel, toLabel)}>
                        <ActionIcon
                          size="xs"
                          variant="transparent"
                          color="gray"
                          aria-label={strings.transitions.staleEdgeRemove(fromLabel, toLabel)}
                          onClick={() => {
                            toggleEdge(edge.from, edge.to, false)
                          }}
                        >
                          <X size={12} aria-hidden />
                        </ActionIcon>
                      </Tooltip>
                    }
                  >
                    {strings.transitions.staleEdgeLabel(fromLabel, toLabel)}
                  </Badge>
                )
              })}
            </Group>
          </Stack>
        ) : null}
        {document.transitionEnforcement && unreachableForward.length > 0
          ? unreachableForward.map((from) => (
              <Text key={from} size="xs" c="orange">
                {strings.transitions.unreachableForward(laneLabel(from))}
              </Text>
            ))
          : null}
      </Stack>
      <Group justify="flex-end">
        <HintButton
          tooltip={strings.transitions.saveTooltip}
          loading={putPolicy.isPending}
          leftSection={<Save size={16} aria-hidden />}
          onClick={() => {
            putPolicy.mutate(document)
          }}
        >
          {strings.transitions.save}
        </HintButton>
      </Group>
    </Stack>
  )
}

import { type PolicyDocument } from '@rivian-kanban/core'
import { Group, Select, Stack, Text, Title } from '@mantine/core'
import { Save } from 'lucide-react'
import { useState } from 'react'
import { HintButton } from '../shell/HintButton.tsx'
import { strings } from '../strings.ts'

export interface WorkingHoursFormProps {
  value: PolicyDocument
  saving: boolean
  onSave: (document: PolicyDocument) => void
}

/** Whole-hour `<Select>` options (inclusive), each labelled as a clock time. */
function hourOptions(from: number, to: number): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = []
  for (let hour = from; hour <= to; hour += 1) {
    options.push({ value: String(hour), label: strings.policy.hourLabel(hour) })
  }
  return options
}

/**
 * The business-hours editor (its own Settings tab, gated on `managePolicy` like
 * the Permissions tab since it PUTs the same policy document): the working day —
 * a start/end hour pair — the work burn-down and the `overdue` facet count
 * business time within (ADR-013). Saving carries every other policy field
 * (roles, transitions) through untouched.
 */
export function WorkingHoursForm({ value, saving, onSave }: WorkingHoursFormProps) {
  const [document, setDocument] = useState<PolicyDocument>(value)

  // Filtering each picker against the other's value keeps start < end without a
  // clamp step (the schema enforces the same rule server-side on save).
  const setBusinessHour = (field: 'startHour' | 'endHour', hour: number) => {
    setDocument((current) => ({
      ...current,
      businessHours: { ...current.businessHours, [field]: hour },
    }))
  }

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Title order={3} size="sm">
          {strings.policy.businessHoursTitle}
        </Title>
        <Text size="xs" c="dimmed">
          {strings.policy.businessHoursHint}
        </Text>
        <Group gap="md" grow>
          <Select
            label={strings.policy.businessHoursStart}
            data={hourOptions(0, document.businessHours.endHour - 1)}
            value={String(document.businessHours.startHour)}
            allowDeselect={false}
            onChange={(next) => {
              if (next !== null) setBusinessHour('startHour', Number(next))
            }}
          />
          <Select
            label={strings.policy.businessHoursEnd}
            data={hourOptions(document.businessHours.startHour + 1, 24)}
            value={String(document.businessHours.endHour)}
            allowDeselect={false}
            onChange={(next) => {
              if (next !== null) setBusinessHour('endHour', Number(next))
            }}
          />
        </Group>
      </Stack>

      <Group justify="flex-end">
        <HintButton
          tooltip={strings.tooltips.saveBusinessHours}
          loading={saving}
          leftSection={<Save size={16} aria-hidden />}
          onClick={() => {
            onSave(document)
          }}
        >
          {strings.common.save}
        </HintButton>
      </Group>
    </Stack>
  )
}

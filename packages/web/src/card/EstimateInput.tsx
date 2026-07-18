import {
  ActionIcon,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { Info } from 'lucide-react'
import { useState } from 'react'
import { useUserTimezone } from '../auth/session-context.ts'
import {
  ESTIMATE_UNITS,
  estimateToMinutes,
  estimateToParts,
  isEstimateUnit,
  todayInTimezone,
  type EstimateUnit,
} from '../lib/format.ts'
import { minutesUntilTargetDate } from '../lib/work-progress.ts'
import { strings } from '../strings.ts'

export interface EstimateInputProps {
  /** Current estimate in stored minutes, or null when unset. */
  minutes: number | null
  disabled?: boolean
  error?: string | undefined
  /** Fires the stored minutes (rounded integer) or the cleared value on empty. */
  onChange: (minutes: number | null | undefined) => void
  /** What "cleared" means for the owning form (null for edit, undefined for create). */
  cleared: null | undefined
}

type EstimateMode = 'duration' | 'date'

/**
 * Estimate entry two ways, both storing integer minutes underneath so a
 * facilities user never does the mental math:
 *
 *  - **Enter time** — a value + DAYS / HOURS / MINUTES unit (workflow.md: 1 day
 *    = 8 working hours); the unit defaults to the friendliest whole split of
 *    the current value ("2d" not "960m").
 *  - **Target date** — a calendar date-picker (same setup as the waiting-lane
 *    resume picker: minDate = today in the viewer's zone, highlightToday), from
 *    which the estimate is derived as the business-hours working time between
 *    now and that date — consistent with how the burn-down bar counts time.
 *
 * The duration value is derived from the `minutes` prop but held locally so the
 * unit choice survives keystrokes; when the prop changes externally (a server
 * refetch of an untouched field) we re-derive so the field stays in sync.
 */
export function EstimateInput({
  minutes,
  disabled = false,
  error,
  onChange,
  cleared,
}: EstimateInputProps) {
  const timezone = useUserTimezone()
  const [mode, setMode] = useState<EstimateMode>('duration')
  const [targetDate, setTargetDate] = useState<string | null>(null)
  const [unit, setUnit] = useState<EstimateUnit>(() =>
    minutes === null ? 'hours' : estimateToParts(minutes).unit,
  )
  const [value, setValue] = useState<number | ''>(() =>
    minutes === null ? '' : estimateToParts(minutes).value,
  )
  // The minutes our local (value, unit) currently represents. When the prop
  // arrives different (external update), re-derive both from it.
  const [syncedMinutes, setSyncedMinutes] = useState<number | null>(minutes)
  if (minutes !== syncedMinutes) {
    setSyncedMinutes(minutes)
    if (minutes === null) {
      setValue('')
    } else {
      const parts = estimateToParts(minutes)
      setValue(parts.value)
      setUnit(parts.unit)
    }
  }

  const emit = (nextValue: number | '', nextUnit: EstimateUnit) => {
    if (typeof nextValue !== 'number') {
      setSyncedMinutes(null)
      onChange(cleared)
      return
    }
    const next = estimateToMinutes(nextValue, nextUnit)
    setSyncedMinutes(next)
    onChange(next)
  }

  // A picked target date becomes the business-hours minutes between now and it,
  // routed through the same store as typed durations (an invalid 0 — no working
  // time left before the date — surfaces via the form's estimate error).
  const emitDate = (date: string | null) => {
    setTargetDate(date)
    if (date === null) {
      setSyncedMinutes(null)
      onChange(cleared)
      return
    }
    const next = minutesUntilTargetDate(date, new Date(), timezone)
    setSyncedMinutes(next)
    onChange(next)
  }

  return (
    <Stack gap="xs">
      <SegmentedControl
        size="xs"
        aria-label={strings.detail.estimateModeLabel}
        data={[
          { value: 'duration', label: strings.detail.estimateModeDuration },
          { value: 'date', label: strings.detail.estimateModeDate },
        ]}
        value={mode}
        disabled={disabled}
        onChange={setMode}
      />
      {mode === 'duration' ? (
        <Group grow align="flex-start" gap="sm">
          <NumberInput
            label={strings.detail.estimateLabel}
            min={0}
            value={value}
            disabled={disabled}
            error={error}
            onChange={(next) => {
              const numeric = typeof next === 'number' ? next : ''
              setValue(numeric)
              emit(numeric, unit)
            }}
          />
          <Select
            label={
              <Group gap={4} wrap="nowrap" component="span">
                {strings.detail.estimateUnitLabel}
                <Tooltip label={strings.detail.estimateUnitHelp} withArrow multiline w={220}>
                  <ActionIcon
                    variant="transparent"
                    color="gray"
                    size="xs"
                    aria-label={strings.detail.estimateUnitHelp}
                  >
                    <Info size={14} aria-hidden />
                  </ActionIcon>
                </Tooltip>
              </Group>
            }
            data={ESTIMATE_UNITS.map((option) => ({
              value: option,
              label: strings.estimateUnits[option],
            }))}
            value={unit}
            allowDeselect={false}
            disabled={disabled}
            onChange={(next) => {
              if (next === null || !isEstimateUnit(next)) return
              setUnit(next)
              emit(value, next)
            }}
          />
        </Group>
      ) : (
        <DatePickerInput
          label={strings.detail.estimateDateLabel}
          value={targetDate}
          error={error}
          disabled={disabled}
          onChange={emitDate}
          minDate={todayInTimezone(timezone)}
          highlightToday
          clearable
        />
      )}
      <Text size="xs" c="dimmed">
        {mode === 'duration' ? strings.detail.estimateOptional : strings.detail.estimateDateHelp}
      </Text>
    </Stack>
  )
}

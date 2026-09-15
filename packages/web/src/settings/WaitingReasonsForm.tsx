import { waitingReasonDefinitionsSchema, type PolicyDocument } from '@rivian-kanban/core'
import { ActionIcon, Group, Stack, Text, TextInput, Tooltip } from '@mantine/core'
import { Plus, Save, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { HintButton } from '../shell/HintButton.tsx'
import { strings } from '../strings.ts'

export function WaitingReasonsForm({
  value,
  saving,
  onSave,
}: {
  value: PolicyDocument
  saving: boolean
  onSave: (document: PolicyDocument) => void
}) {
  const [reasons, setReasons] = useState(value.waitingReasons)
  const parsed = waitingReasonDefinitionsSchema.safeParse(reasons)
  const dirty = JSON.stringify(reasons) !== JSON.stringify(value.waitingReasons)
  const lastReason = reasons.filter((reason) => reason.active).length === 1
  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        {strings.waitingSettings.intro}
      </Text>
      {reasons
        .filter((reason) => reason.active)
        .map((reason) => (
          <Group key={reason.key} gap="xs" wrap="nowrap">
            <TextInput
              flex={1}
              miw={0}
              aria-label={strings.waitingSettings.nameLabel(reason.label)}
              placeholder={strings.waitingSettings.namePlaceholder}
              value={reason.label}
              disabled={saving}
              onChange={(event) => {
                const label = event.currentTarget.value
                setReasons((current) =>
                  current.map((item) => (item.key === reason.key ? { ...item, label } : item)),
                )
              }}
            />
            <Tooltip
              label={
                lastReason
                  ? strings.waitingSettings.keepOne
                  : strings.waitingSettings.removeLabel(reason.label)
              }
            >
              <span>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  disabled={saving || lastReason}
                  aria-label={strings.waitingSettings.removeLabel(reason.label)}
                  onClick={() => {
                    const saved = value.waitingReasons.find((item) => item.key === reason.key)
                    setReasons((current) =>
                      saved !== undefined
                        ? current.map((item) =>
                            item.key === reason.key ? { ...saved, active: false } : item,
                          )
                        : current.filter((item) => item.key !== reason.key),
                    )
                  }}
                >
                  <Trash2 size={16} aria-hidden />
                </ActionIcon>
              </span>
            </Tooltip>
          </Group>
        ))}
      {!parsed.success ? (
        <Text size="sm" c="red" role="alert">
          {strings.waitingSettings.invalid}
        </Text>
      ) : null}
      <Group justify="space-between">
        <HintButton
          variant="default"
          tooltip={strings.waitingSettings.add}
          disabled={saving}
          leftSection={<Plus size={16} aria-hidden />}
          onClick={() => {
            setReasons((current) => [
              ...current,
              {
                key: `reason_${crypto.randomUUID().replaceAll('-', '')}`,
                label: strings.waitingSettings.newReason,
                active: true,
              },
            ])
          }}
        >
          {strings.waitingSettings.add}
        </HintButton>
        <HintButton
          tooltip={strings.waitingSettings.save}
          loading={saving}
          leftSection={<Save size={16} aria-hidden />}
          disabledReason={
            !parsed.success
              ? strings.waitingSettings.invalid
              : !dirty
                ? strings.tooltips.disabledNoChanges
                : undefined
          }
          onClick={() => {
            if (parsed.success) onSave({ ...value, waitingReasons: parsed.data })
          }}
        >
          {strings.waitingSettings.save}
        </HintButton>
      </Group>
    </Stack>
  )
}

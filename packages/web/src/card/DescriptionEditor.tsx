import { Input, SegmentedControl, Stack, Text, Textarea, Typography } from '@mantine/core'
import { useId, useState } from 'react'
import Markdown from 'react-markdown'
import { strings } from '../strings.ts'

export interface DescriptionEditorProps {
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}

/** Markdown editor with a write/preview toggle (react-markdown rendering). */
export function DescriptionEditor({ value, disabled = false, onChange }: DescriptionEditorProps) {
  const [mode, setMode] = useState<'write' | 'preview'>('write')
  const labelId = useId()

  return (
    <Stack gap="xs">
      <Input.Label id={labelId}>{strings.detail.descriptionLabel}</Input.Label>
      <SegmentedControl
        size="xs"
        data={[
          { value: 'write', label: strings.detail.descriptionWrite },
          { value: 'preview', label: strings.detail.descriptionPreview },
        ]}
        value={mode}
        onChange={(next) => {
          setMode(next === 'preview' ? 'preview' : 'write')
        }}
      />
      <Text size="xs" c="dimmed">
        {strings.detail.descriptionHelp}
      </Text>
      {mode === 'write' ? (
        <Textarea
          aria-labelledby={labelId}
          autosize
          minRows={4}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.currentTarget.value)
          }}
        />
      ) : value === '' ? (
        <Text size="sm" c="dimmed">
          {strings.detail.descriptionEmpty}
        </Text>
      ) : (
        <Typography>
          <Markdown>{value}</Markdown>
        </Typography>
      )}
    </Stack>
  )
}

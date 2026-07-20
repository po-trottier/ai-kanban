import { ALLOWED_ATTACHMENT_MIME_TYPES } from '@rivian-kanban/core'
import { ActionIcon, Button, Group, Stack, Text, Title, Tooltip } from '@mantine/core'
import { Upload, X } from 'lucide-react'
import { useState, type DragEvent } from 'react'
import { strings } from '../strings.ts'
import { cx } from '../lib/cx.ts'
import classes from '../card/card.module.css'

/**
 * Attachment picker for the CREATE form: the work order doesn't exist yet, so
 * files are gathered locally (name + remove) and uploaded by CreateCardModal
 * once the work order is created. Mirrors the detail-panel dropzone but lists
 * pending files instead of server thumbnails.
 */
export function NewCardAttachments({
  files,
  onAdd,
  onRemove,
}: {
  files: File[]
  onAdd: (file: File) => void
  onRemove: (index: number) => void
}) {
  const [dragActive, setDragActive] = useState(false)

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragActive(false)
    for (const file of Array.from(event.dataTransfer.files)) onAdd(file)
  }

  return (
    <Stack gap="sm">
      <Title order={4} size="sm">
        {strings.attachments.sectionTitle}
      </Title>
      {files.length === 0 ? null : (
        <Stack gap="xs">
          {files.map((file, index) => (
            <Group
              key={`${file.name}-${String(index)}`}
              justify="space-between"
              gap="xs"
              wrap="nowrap"
            >
              <Text size="sm" truncate>
                {file.name}
              </Text>
              <Tooltip label={strings.attachments.deleteLabel(file.name)}>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  size="sm"
                  aria-label={strings.attachments.deleteLabel(file.name)}
                  onClick={() => {
                    onRemove(index)
                  }}
                >
                  <X size={16} aria-hidden />
                </ActionIcon>
              </Tooltip>
            </Group>
          ))}
        </Stack>
      )}
      <div
        role="group"
        aria-label={strings.attachments.dropzoneLabel}
        className={cx(classes.dropzone, dragActive && classes.dropzoneActive)}
        onDragOver={(event) => {
          event.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={() => {
          setDragActive(false)
        }}
        onDrop={onDrop}
      >
        <Group justify="center" gap="xs">
          <Text size="sm" c="dimmed">
            {strings.attachments.dropHint}
          </Text>
          <Tooltip label={strings.tooltips.browseFiles}>
            <Button
              variant="light"
              size="xs"
              component="label"
              leftSection={<Upload size={14} aria-hidden />}
            >
              {strings.attachments.browseButton}
              <input
                type="file"
                hidden
                accept={ALLOWED_ATTACHMENT_MIME_TYPES.join(',')}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  if (file !== undefined) onAdd(file)
                  event.currentTarget.value = ''
                }}
              />
            </Button>
          </Tooltip>
        </Group>
      </div>
    </Stack>
  )
}

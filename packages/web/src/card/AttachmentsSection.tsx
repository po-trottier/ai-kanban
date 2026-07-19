import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ACTIVE_ATTACHMENTS_PER_CARD,
  MAX_ATTACHMENT_BYTES,
  type Attachment,
} from '@rivian-kanban/core'
import {
  ActionIcon,
  Anchor,
  Button,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core'
import { Trash2, Upload } from 'lucide-react'
import { useState, type DragEvent } from 'react'
import { attachmentUrl } from '../api/card.ts'
import { notifyError } from '../api/notify.ts'
import { FieldLabel } from '../shell/FieldLabel.tsx'
import { strings } from '../strings.ts'
import { cx } from '../lib/cx.ts'
import classes from './card.module.css'

const ALLOWED_MIME: ReadonlySet<string> = new Set(ALLOWED_ATTACHMENT_MIME_TYPES)

export interface AttachmentsSectionProps {
  attachments: Attachment[]
  currentUserId: string
  /** Policy affordance: the `deleteOthersAttachments` gate (ADR-013). */
  canDeleteOthers: boolean
  uploading: boolean
  /** Id of the attachment whose delete is in flight (spins that row's trash icon). */
  deletingId?: string | null
  /** Archived cards are read-only except reopen (workflow.md#terminal-states). */
  readOnly?: boolean
  onUpload: (file: File) => void
  onDelete: (attachmentId: string) => void
}

/** Dropzone + thumbnails + delete for card attachments (images and PDFs). */
export function AttachmentsSection({
  attachments,
  currentUserId,
  canDeleteOthers,
  uploading,
  deletingId = null,
  readOnly = false,
  onUpload,
  onDelete,
}: AttachmentsSectionProps) {
  const [dragActive, setDragActive] = useState(false)

  /**
   * Validate a picked/dropped batch against the SAME core caps the server
   * enforces, so we skip doomed requests: reject the whole batch up front if it
   * would push the card over MAX_ACTIVE_ATTACHMENTS_PER_CARD, and drop
   * oversized/wrong-type files individually (each with a toast). Every survivor
   * is handed to onUpload — CardPanel fires one mutation per file, so per-file
   * request errors (413/415/409) still surface via the hook's onError.
   */
  const handleFiles = (files: File[]) => {
    if (files.length === 0) return
    if (attachments.length + files.length > MAX_ACTIVE_ATTACHMENTS_PER_CARD) {
      notifyError(new Error(strings.attachments.tooMany(MAX_ACTIVE_ATTACHMENTS_PER_CARD)))
      return
    }
    for (const file of files) {
      if (!ALLOWED_MIME.has(file.type)) {
        notifyError(new Error(strings.attachments.wrongType(file.name)))
        continue
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        notifyError(new Error(strings.attachments.tooLarge(file.name)))
        continue
      }
      onUpload(file)
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragActive(false)
    handleFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <Stack gap="sm">
      <Title order={4} size="sm">
        <FieldLabel
          label={strings.attachments.sectionTitle}
          help={strings.attachments.sectionHelp}
        />
      </Title>
      {attachments.length === 0 ? (
        <Text size="sm" c="dimmed">
          {strings.attachments.empty}
        </Text>
      ) : (
        <SimpleGrid cols={3} spacing="sm">
          {attachments.map((attachment) => (
            <Stack key={attachment.id} gap="xs" align="center">
              <Anchor href={attachmentUrl(attachment.id)} download={attachment.filename}>
                {attachment.mime.startsWith('image/') ? (
                  <img
                    className={classes.thumbnail}
                    src={attachmentUrl(attachment.id)}
                    alt={attachment.filename}
                  />
                ) : (
                  <Text size="sm">{attachment.filename}</Text>
                )}
              </Anchor>
              {/* Deleting is uploader-only unless the policy gate opens it (ADR-013). */}
              {!readOnly && (attachment.uploadedBy === currentUserId || canDeleteOthers) ? (
                <Tooltip label={strings.attachments.deleteLabel(attachment.filename)}>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    size="sm"
                    loading={deletingId === attachment.id}
                    aria-label={strings.attachments.deleteLabel(attachment.filename)}
                    onClick={() => {
                      onDelete(attachment.id)
                    }}
                  >
                    <Trash2 size={16} aria-hidden />
                  </ActionIcon>
                </Tooltip>
              ) : null}
            </Stack>
          ))}
        </SimpleGrid>
      )}
      {readOnly ? null : (
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
                loading={uploading}
                component="label"
                leftSection={<Upload size={14} aria-hidden />}
              >
                {strings.attachments.browseButton}
                <input
                  type="file"
                  hidden
                  multiple
                  accept={ALLOWED_ATTACHMENT_MIME_TYPES.join(',')}
                  onChange={(event) => {
                    handleFiles(Array.from(event.currentTarget.files ?? []))
                    event.currentTarget.value = ''
                  }}
                />
              </Button>
            </Tooltip>
          </Group>
        </div>
      )}
    </Stack>
  )
}

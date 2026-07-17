import {
  CARD_TITLE_MAX,
  PRIORITIES,
  TAG_NAME_MAX,
  type Priority,
  type SummaryDraft,
} from '@rivian-kanban/core'
import { type types } from '@slack/bolt'
import { z } from 'zod'

/**
 * Modal builders and submission parsing for the message-shortcut flow
 * (docs/architecture/slack.md#message-shortcut-flow). The draft is fully
 * editable — AI values are ordinary prefills the human reviews.
 */

export const DRAFT_CALLBACK_ID = 'facilities_ticket_draft'

/**
 * Block ids are the single source for building the modal, parsing its
 * submission, and the recorded test fixtures — a rename cannot drift.
 */
export const TITLE_BLOCK = 'title_block'
export const DESCRIPTION_BLOCK = 'description_block'
export const PRIORITY_BLOCK = 'priority_block'
export const TAGS_BLOCK = 'tags_block'
export const ASSIGNEE_BLOCK = 'assignee_block'
export const LOCATION_BLOCK = 'location_block'

const INPUT_ACTION = 'input'

/**
 * Slack caps a plain_text_input `initial_value` at 3,000 characters — well
 * under the 20,000-char card description cap — so longer thread prefills are
 * truncated with a visible marker; the permalink preserves the full thread
 * (documented deviation, docs/architecture/slack.md#message-shortcut-flow).
 */
const DESCRIPTION_PREFILL_MAX = 3_000
const TRUNCATION_MARKER = '…\n[thread truncated — see the Slack thread via its permalink]'

function prefillDescription(description: string): string {
  if (description.length <= DESCRIPTION_PREFILL_MAX) return description
  return (
    description.slice(0, DESCRIPTION_PREFILL_MAX - TRUNCATION_MARKER.length) + TRUNCATION_MARKER
  )
}

/** Slack thread coordinates carried through the modal's private_metadata. */
const slackSourceMetaSchema = z.object({
  channelId: z.string().min(1),
  threadTs: z.string().min(1),
  permalink: z.string().min(1),
})
export type SlackSourceMeta = z.infer<typeof slackSourceMetaSchema>

const MODAL_TITLE = { type: 'plain_text' as const, text: 'New facilities ticket' }

/** Shown immediately after ack — the trigger_id is short-lived (3 s). */
export function loadingModal(): types.ModalView {
  return {
    type: 'modal',
    title: MODAL_TITLE,
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: { type: 'plain_text', text: 'Reading the thread and drafting your ticket…' },
      },
    ],
  }
}

/** Friendly dead-end (unknown user, unexpected failure) in the open modal. */
export function noticeModal(message: string): types.ModalView {
  return {
    type: 'modal',
    title: MODAL_TITLE,
    close: { type: 'plain_text', text: 'Close' },
    blocks: [{ type: 'section', text: { type: 'plain_text', text: message } }],
  }
}

function plainTextInput(
  blockId: string,
  label: string,
  options: { initialValue?: string; multiline?: boolean; optional?: boolean; hint?: string },
): types.InputBlock {
  return {
    type: 'input',
    block_id: blockId,
    optional: options.optional ?? false,
    label: { type: 'plain_text', text: label },
    ...(options.hint !== undefined
      ? { hint: { type: 'plain_text' as const, text: options.hint } }
      : {}),
    element: {
      type: 'plain_text_input',
      action_id: INPUT_ACTION,
      multiline: options.multiline ?? false,
      ...(options.initialValue !== undefined && options.initialValue.length > 0
        ? { initial_value: options.initialValue }
        : {}),
    },
  }
}

function priorityOption(priority: Priority): types.PlainTextOption {
  return { text: { type: 'plain_text', text: priority }, value: priority }
}

/** The editable, prefilled draft (flow step 4). */
export function draftModal(draft: SummaryDraft, meta: SlackSourceMeta): types.ModalView {
  return {
    type: 'modal',
    callback_id: DRAFT_CALLBACK_ID,
    private_metadata: JSON.stringify(meta),
    title: MODAL_TITLE,
    submit: { type: 'plain_text', text: 'Create ticket' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      plainTextInput(TITLE_BLOCK, 'Title', { initialValue: draft.title.slice(0, CARD_TITLE_MAX) }),
      plainTextInput(DESCRIPTION_BLOCK, 'Description', {
        initialValue: prefillDescription(draft.description),
        multiline: true,
        optional: true,
      }),
      {
        type: 'input',
        block_id: PRIORITY_BLOCK,
        label: { type: 'plain_text', text: 'Priority' },
        element: {
          type: 'static_select',
          action_id: INPUT_ACTION,
          options: PRIORITIES.map(priorityOption),
          initial_option: priorityOption(draft.suggestedPriority),
        },
      },
      plainTextInput(TAGS_BLOCK, 'Tags', {
        initialValue: draft.tags.join(', '),
        optional: true,
        hint: 'Comma-separated, e.g. hvac, bay-4',
      }),
      plainTextInput(ASSIGNEE_BLOCK, 'Assignee email', {
        optional: true,
        hint: 'Board user email; leave empty for triage to assign',
      }),
      plainTextInput(LOCATION_BLOCK, 'Location', {
        optional: true,
        hint: 'Exact location name from the board',
      }),
    ],
  }
}

export interface DraftSubmission {
  title: string
  description: string
  priority: Priority
  tags: string[]
  assigneeEmail: string | null
  locationName: string | null
  meta: SlackSourceMeta
}

interface SubmittedInput {
  input?: { value?: string | null; selected_option?: { value?: string } | null }
}

interface SubmittedView {
  private_metadata: string
  state: {
    values: Record<string, SubmittedInput | undefined>
  }
}

const prioritySchema = z.enum(PRIORITIES)

function textOf(block: SubmittedInput | undefined): string {
  return block?.input?.value?.trim() ?? ''
}

/** Extracts the edited draft from a view_submission payload. */
export function parseDraftSubmission(view: SubmittedView): DraftSubmission {
  const meta = slackSourceMetaSchema.parse(JSON.parse(view.private_metadata) as unknown)
  // Computed keys from the exported block-id constants — the same values the
  // modal is built from, so a renamed block cannot silently drop a field.
  const {
    [TITLE_BLOCK]: title,
    [DESCRIPTION_BLOCK]: description,
    [PRIORITY_BLOCK]: priority,
    [TAGS_BLOCK]: tags,
    [ASSIGNEE_BLOCK]: assignee,
    [LOCATION_BLOCK]: location,
  } = view.state.values
  return {
    title: textOf(title),
    description: textOf(description),
    priority: prioritySchema.catch('P2').parse(priority?.input?.selected_option?.value),
    tags: textOf(tags)
      .split(',')
      .map((tag) => tag.trim().slice(0, TAG_NAME_MAX))
      .filter((tag) => tag.length > 0),
    assigneeEmail: textOf(assignee) || null,
    locationName: textOf(location) || null,
    meta,
  }
}

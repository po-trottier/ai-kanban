import {
  ASSIGNEE_BLOCK,
  DESCRIPTION_BLOCK,
  DRAFT_CALLBACK_ID,
  LOCATION_BLOCK,
  PRIORITY_BLOCK,
  TAGS_BLOCK,
  TITLE_BLOCK,
} from '../../src/slack/views.ts'

/**
 * Recorded Slack payload shapes (docs/dev/testing.md#fixtures): real captured
 * payloads, trimmed and anonymized, parameterized only where tests vary
 * (ids, text, team). Block/action ids are imported from the view builders so
 * the fixtures can never drift from the modal the app actually opens.
 */

const TEST_TEAM_ID = 'T0TEST'
const BOT_USER_ID = 'UBOT001'

let sequence = 0
function nextId(prefix: string): string {
  sequence += 1
  return `${prefix}${String(sequence).padStart(6, '0')}`
}

export interface MessageActionOptions {
  userId?: string
  channelId?: string
  messageTs?: string
  threadTs?: string
  triggerId?: string
  teamId?: string
}

/** `message_action` — the "Create facilities ticket" shortcut invocation. */
export function messageActionPayload(options: MessageActionOptions = {}): Record<string, unknown> {
  const {
    userId = 'U0REPORTER',
    channelId = 'C0FACILITIES',
    messageTs = '1752749000.000100',
    threadTs,
    triggerId = nextId('9999.trigger'),
    teamId = TEST_TEAM_ID,
  } = options
  return {
    type: 'message_action',
    callback_id: 'create_facilities_ticket',
    trigger_id: triggerId,
    token: 'fixture-verification-token',
    action_ts: '1752749100.000000',
    team: { id: teamId, domain: 'fixture-workspace' },
    user: { id: userId, username: 'reporter', team_id: teamId, name: 'reporter' },
    channel: { id: channelId, name: 'facilities' },
    is_enterprise_install: false,
    enterprise: null,
    message: {
      type: 'message',
      user: userId,
      ts: messageTs,
      text: 'The compressor in bay 4 is leaking oil again',
      ...(threadTs !== undefined ? { thread_ts: threadTs } : {}),
    },
    response_url: 'https://hooks.slack.com/app/T0TEST/fixture/response',
  }
}

export interface AppMentionOptions {
  text?: string
  userId?: string
  channelId?: string
  ts?: string
  threadTs?: string
  eventId?: string
  teamId?: string
}

/** `event_callback` envelope carrying an `app_mention` event. */
export function appMentionEnvelope(options: AppMentionOptions = {}): Record<string, unknown> {
  const {
    text = `<@${BOT_USER_ID}> create ticket P1 Compressor leaking in bay 4`,
    userId = 'U0REPORTER',
    channelId = 'C0FACILITIES',
    ts = '1752749200.000300',
    threadTs,
    eventId = nextId('Ev'),
    teamId = TEST_TEAM_ID,
  } = options
  return {
    token: 'fixture-verification-token',
    team_id: teamId,
    api_app_id: 'A0FIXTURE',
    type: 'event_callback',
    event_id: eventId,
    event_time: 1752749200,
    is_ext_shared_channel: false,
    authorizations: [
      {
        enterprise_id: null,
        team_id: teamId,
        user_id: BOT_USER_ID,
        is_bot: true,
        is_enterprise_install: false,
      },
    ],
    event: {
      type: 'app_mention',
      user: userId,
      text,
      ts,
      event_ts: ts,
      channel: channelId,
      ...(threadTs !== undefined ? { thread_ts: threadTs } : {}),
    },
  }
}

interface DraftValueOptions {
  title?: string
  description?: string
  priority?: 'P0' | 'P1' | 'P2'
  tags?: string
  assigneeEmail?: string
  locationName?: string
}

export interface ViewSubmissionOptions {
  userId?: string
  teamId?: string
  meta?: { channelId: string; threadTs: string; permalink: string }
  values?: DraftValueOptions
}

export const DEFAULT_SUBMISSION_META = {
  channelId: 'C0FACILITIES',
  threadTs: '1752749000.000100',
  permalink: 'https://slack.com/archives/C0FACILITIES/p1752749000000100',
}

function plainTextState(value: string | undefined): Record<string, unknown> {
  return { input: { type: 'plain_text_input', value: value ?? null } }
}

/** `view_submission` for the draft modal, with the human-edited values. */
export function viewSubmissionPayload(
  options: ViewSubmissionOptions = {},
): Record<string, unknown> {
  const { userId = 'U0REPORTER', teamId = TEST_TEAM_ID, meta = DEFAULT_SUBMISSION_META } = options
  const values = options.values ?? {}
  const priority = values.priority ?? 'P1'
  return {
    type: 'view_submission',
    token: 'fixture-verification-token',
    trigger_id: nextId('9999.trigger'),
    team: { id: teamId, domain: 'fixture-workspace' },
    user: { id: userId, username: 'reporter', name: 'reporter', team_id: teamId },
    api_app_id: 'A0FIXTURE',
    is_enterprise_install: false,
    enterprise: null,
    response_urls: [],
    view: {
      id: 'V0FIXTURE',
      team_id: teamId,
      type: 'modal',
      callback_id: DRAFT_CALLBACK_ID,
      private_metadata: JSON.stringify(meta),
      hash: 'fixturehash1',
      app_id: 'A0FIXTURE',
      bot_id: 'B0BOT001',
      root_view_id: 'V0FIXTURE',
      state: {
        values: {
          [TITLE_BLOCK]: plainTextState(values.title ?? 'Compressor leaking in bay 4'),
          [DESCRIPTION_BLOCK]: plainTextState(
            values.description ?? 'Leaking oil under the intake side; needs a new hose.',
          ),
          [PRIORITY_BLOCK]: {
            input: {
              type: 'static_select',
              selected_option: {
                text: { type: 'plain_text', text: priority },
                value: priority,
              },
            },
          },
          [TAGS_BLOCK]: plainTextState(values.tags),
          [ASSIGNEE_BLOCK]: plainTextState(values.assigneeEmail),
          [LOCATION_BLOCK]: plainTextState(values.locationName),
        },
      },
    },
  }
}

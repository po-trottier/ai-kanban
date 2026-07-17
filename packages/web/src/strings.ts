import {
  PASSWORD_MIN_LENGTH,
  type CancelResolution,
  type LaneKey,
  type Priority,
  type Resolution,
  type Role,
  type TokenScope,
  type WaitingReason,
} from '@rivian-kanban/core'

/**
 * Every user-facing English string lives here (i18n deferral rule: one module
 * to translate later, no literals scattered through components).
 */

export const strings = {
  appTitle: 'Facilities Kanban',

  common: {
    save: 'Save',
    cancel: 'Cancel',
    create: 'Create',
    delete: 'Delete',
    edit: 'Edit',
    reply: 'Reply',
    close: 'Close',
    loadMore: 'Load more',
    loading: 'Loading…',
    genericError: 'Something went wrong. Please try again.',
    validationIssues: 'Some fields need attention:',
    notAvailable: '—',
    reload: 'Reload',
  },

  auth: {
    loginTitle: 'Sign in',
    email: 'Email',
    password: 'Password',
    loginButton: 'Sign in',
    emailInvalid: 'Enter a valid email address',
    passwordRequired: 'Enter your password',
    logout: 'Log out',
    changePasswordTitle: 'Change your password',
    changePasswordIntro: 'You must change your temporary password before continuing.',
    currentPassword: 'Current password',
    newPassword: 'New password',
    confirmPassword: 'Confirm new password',
    passwordMinLength: `Password must be at least ${String(PASSWORD_MIN_LENGTH)} characters`,
    passwordMismatch: 'Passwords do not match',
    changePasswordButton: 'Change password',
    passwordChanged: 'Password changed',
  },

  setup: {
    title: 'Create the admin account',
    intro: 'This instance has no users yet. Create the first administrator account to begin.',
    displayName: 'Display name',
    displayNameRequired: 'Enter a display name',
    submitButton: 'Create admin account',
  },

  board: {
    boardLabel: 'Kanban board',
    newCard: 'New card',
    emptyLane: 'No cards',
    wipLimitExceededSuffix: 'WIP limit exceeded',
    cardListLabel: (lane: string) => `Cards in ${lane}`,
    loadFailed: 'The board could not be loaded.',
  },

  card: {
    menuLabel: 'Card actions',
    openCard: 'Open card',
    moveTo: 'Move to…',
    block: 'Block…',
    unblock: 'Unblock',
    cancelCard: 'Cancel…',
    reopen: 'Reopen',
    blockedBadge: 'Blocked',
    waitingBadge: (reason: string) => `Waiting: ${reason}`,
    overdueBadge: (reason: string) => `Overdue: ${reason}`,
    archivedBadge: 'Archived',
    assigneeAvatarLabel: (name: string) => `Assigned to ${name}`,
    cardJustUpdated: 'This card was just updated by someone else — the board has been refreshed.',
    moveAnnouncement: (title: string, lane: string, position: number) =>
      `Card "${title}" moved to ${lane}, position ${String(position)}`,
  },

  search: {
    pageTitle: 'Search cards',
    openButton: 'Search cards',
    queryLabel: 'Search',
    /** Stable accessible name for the query input (tests target it) while the
     * visible label stays short under the identical page title. */
    queryAriaLabel: 'Search cards',
    submit: 'Search',
    includeArchived: 'Include archived',
    resultsLabel: 'Search results',
    empty: 'No matching cards',
    loadFailed: 'Cards could not be loaded.',
  },

  move: {
    modalTitle: 'Move card',
    laneLabel: 'Column',
    positionLabel: 'Position',
    positionFirst: 'First',
    positionAfter: (title: string) => `After "${title}"`,
    moveButton: 'Move',
    laneNotAllowed: 'Not allowed from the current column',
  },

  waiting: {
    modalTitle: 'Waiting on Parts / Vendor',
    intro: 'Entering this column requires a reason and an expected resume date.',
    reasonLabel: 'Waiting reason',
    resumeLabel: 'Expected resume date',
    reasonRequired: 'Pick a waiting reason',
    resumeRequired: 'Pick the expected resume date',
    confirm: 'Move card',
    reasons: {
      parts: 'Parts',
      vendor: 'Vendor',
      access: 'Access',
      info: 'Information',
      funding: 'Funding',
    } satisfies Record<WaitingReason, string>,
  },

  cancelAction: {
    modalTitle: 'Cancel card',
    resolutionLabel: 'Reason',
    confirm: 'Cancel card',
    resolutions: {
      cancelled: 'Cancelled',
      declined: 'Declined',
      duplicate: 'Duplicate',
    } satisfies Record<CancelResolution, string>,
  },

  blockAction: {
    modalTitle: 'Block card',
    reasonLabel: 'What is blocking this card?',
    reasonRequired: 'Enter a reason',
    confirm: 'Block card',
  },

  detail: {
    tabDetails: 'Details',
    tabComments: 'Comments',
    tabHistory: 'History',
    titleLabel: 'Title',
    descriptionLabel: 'Description',
    descriptionWrite: 'Write',
    descriptionPreview: 'Preview',
    descriptionEmpty: 'Nothing to preview',
    priorityLabel: 'Priority',
    estimateLabel: 'Estimate (minutes)',
    assigneeLabel: 'Assignee',
    locationLabel: 'Location',
    tagsLabel: 'Tags',
    reporterLabel: 'Reporter',
    createdLabel: 'Created',
    saveFields: 'Save changes',
    fieldsSaved: 'Card updated',
    panelLabel: 'Card details',
    loadFailed: 'The card could not be loaded.',
    archivedNotice: 'This card is archived — reopen it to make changes.',
  },

  attachments: {
    sectionTitle: 'Attachments',
    dropzoneLabel: 'Attachment dropzone',
    dropHint: 'Drop images or PDFs here, or',
    browseButton: 'Browse files',
    deleteLabel: (filename: string) => `Delete ${filename}`,
    empty: 'No attachments yet',
    uploaded: 'Attachment uploaded',
  },

  comments: {
    composerLabel: 'Add a comment',
    composerPlaceholder: 'Write a comment…',
    postButton: 'Comment',
    postReplyButton: 'Post reply',
    replyComposerLabel: 'Reply',
    deletedPlaceholder: '(deleted)',
    empty: 'No comments yet',
    itemLabel: (name: string) => `Comment by ${name}`,
    editLabel: 'Edit comment',
    deleteLabel: 'Delete comment',
    saveEdit: 'Save',
  },

  history: {
    empty: 'No history yet',
    actorSystem: 'System',
    actorSlack: 'Slack',
    actorAgent: 'AI agent',
    unknownUser: 'Someone',
    event: {
      created: 'created the card',
      statusChanged: (from: string, to: string) => `moved the card from ${from} to ${to}`,
      reordered: (lane: string) => `reordered the card within ${lane}`,
      fieldChanged: (field: string) => `changed ${field}`,
      blocked: (reason: string) => `blocked the card: ${reason}`,
      unblocked: 'unblocked the card',
      cancelled: (resolution: string) => `cancelled the card (${resolution})`,
      reopened: (lane: string) => `reopened the card into ${lane}`,
      archived: 'archived the card',
      commentAdded: 'commented',
      commentEdited: 'edited a comment',
      commentDeleted: 'deleted a comment',
      attachmentAdded: (filename: string) => `attached ${filename}`,
      attachmentRemoved: (filename: string) => `removed attachment ${filename}`,
      piiDeleted: 'redacted personal data',
    },
  },

  newCard: {
    modalTitle: 'New card',
    created: 'Card created in Intake',
  },

  settings: {
    pageTitle: 'Settings',
    gearLabel: 'Settings',
    adminsOnly: 'Only admins can open settings.',
    tabUsers: 'Users',
    tabLanes: 'Columns',
    tabPolicy: 'Permissions',
    tabLocations: 'Locations',
    tabTokens: 'Service tokens',
  },

  users: {
    createButton: 'New user',
    createTitle: 'Create user',
    nameLabel: 'Display name',
    nameRequired: 'Enter a display name',
    emailLabel: 'Email',
    roleLabel: 'Role',
    deactivate: 'Deactivate',
    deactivateConfirmTitle: 'Deactivate user',
    deactivateConfirmBody: (name: string) =>
      `Deactivate ${name}? They can no longer sign in, and reactivating currently requires API access.`,
    resetPassword: 'Reset password',
    tempPasswordTitle: 'One-time temporary password',
    tempPasswordHint:
      'Share this password securely. It is shown only once; the user must change it at first sign-in.',
    userCreated: 'User created',
    userUpdated: 'User updated',
    roles: {
      requester: 'Requester',
      technician: 'Technician',
      supervisor: 'Supervisor',
      admin: 'Admin',
    } satisfies Record<Role, string>,
  },

  lanes: {
    keyHeader: 'Column',
    labelHeader: 'Label',
    labelLabel: 'Column label',
    wipLimitLabel: 'WIP limit',
    wipLimitNone: 'No limit',
    saved: 'Column updated',
    rowLabel: (lane: string) => `Column ${lane}`,
  },

  policy: {
    enforcementLabel: 'Enforce workflow transitions',
    enforcementHint:
      'When on, cards may only move along the workflow graph below, and role gates apply.',
    transitionsTitle: 'Workflow graph',
    transitionRowLabel: (from: string, to: string) => `${from} to ${to}`,
    minRoleLabel: 'Minimum role',
    anyRole: 'Any role',
    actionGatesTitle: 'Action gates',
    gates: {
      cancel: 'Cancel cards',
      reopen: 'Reopen cards',
      reorderReady: 'Reorder the Ready column',
      deleteOthersComments: "Delete others' comments",
      deleteOthersAttachments: "Delete others' attachments",
    },
    saved: 'Policy updated',
  },

  locations: {
    addRoot: 'Add building',
    addChildLabel: (name: string) => `Add inside ${name}`,
    renameLabel: (name: string) => `Rename ${name}`,
    deleteLabel: (name: string) => `Delete ${name}`,
    nameLabel: 'Name',
    nameRequired: 'Enter a name',
    addTitle: 'Add location',
    renameTitle: 'Rename location',
    empty: 'No locations yet',
    treeLabel: 'Location tree',
  },

  tokens: {
    createButton: 'New token',
    createTitle: 'Create service token',
    nameLabel: 'Name',
    nameRequired: 'Enter a token name',
    roleLabel: 'Role',
    scopeLabel: 'Scope',
    scopes: {
      read: 'Read-only',
      read_write: 'Read + write',
    } satisfies Record<TokenScope, string>,
    revoke: 'Revoke',
    revoked: 'Revoked',
    active: 'Active',
    tokenTitle: 'Service token created',
    tokenHint: 'Copy this token now — it is shown only once.',
    lastUsed: 'Last used',
    neverUsed: 'Never',
    empty: 'No service tokens yet',
  },

  laneNames: {
    intake: 'Intake',
    waiting_approval: 'Waiting for Approval',
    ready: 'Ready',
    in_progress: 'In Progress',
    waiting_parts_vendor: 'Waiting on Parts / Vendor',
    review: 'Review',
    done: 'Done',
  } satisfies Record<LaneKey, string>,

  priorities: {
    P0: 'P0',
    P1: 'P1',
    P2: 'P2',
  } satisfies Record<Priority, string>,

  resolutions: {
    completed: 'Completed',
    cancelled: 'Cancelled',
    declined: 'Declined',
    duplicate: 'Duplicate',
  } satisfies Record<Resolution, string>,
} as const

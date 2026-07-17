import {
  PASSWORD_MIN_LENGTH,
  type CancelResolution,
  type LaneKey,
  type LocationKind,
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
    /** Friendly, specific 401 copy (never the raw transport title). */
    loginFailed: 'That email or password is not correct.',
    /** On-screen help for a stuck user (no self-service reset in v1). */
    forgotHelp:
      'Forgot your password? Ask an admin to reset it. Temp passwords are set by your admin.',
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
    locationsTitle: 'Add your locations',
    locationsOptional: 'Optional',
    locationsIntro:
      'Set up your buildings, floors, and rooms so work orders can point to where they are. This is optional — you can add or manage locations anytime later in Settings.',
    locationsEmpty:
      'No locations yet. Add a building to get started, or skip this — you can always set them up later in Settings.',
    addBuilding: 'Add building',
    addFloor: 'Add floor',
    addRoom: 'Add room',
    addBuildingPlaceholder: 'Building name',
    addFloorPlaceholder: 'Floor name',
    addRoomPlaceholder: 'Room name',
    removeLocationLabel: (name: string) => `Remove ${name}`,
    removeTitle: 'Remove location',
    removeConfirmBody: (name: string) => `Remove “${name}”?`,
    removeWarnsDescendants: (name: string) =>
      `Everything inside “${name}” (its floors and rooms) will be removed too.`,
    confirmRemove: 'Remove',
    skipButton: 'Skip for now',
    continueButton: 'Continue to board',
  },

  board: {
    boardLabel: 'Kanban board',
    newCard: 'New card',
    emptyLane: 'No cards',
    wipLimitExceededSuffix: 'WIP limit exceeded',
    cardListLabel: (lane: string) => `Cards in ${lane}`,
    loadFailed: 'The board could not be loaded.',
    /** Move confirmation toasts (every move reassures a non-technical user). */
    moved: 'Card moved',
    movedTo: (lane: string) => `Card moved to ${lane}`,
    /** WIP badge tooltip + visible over-limit cue. */
    wipTooltip: (count: number, limit: number) =>
      `${String(count)} of ${String(limit)} — this column's work-in-progress limit`,
    wipNoLimitTooltip: (count: number) =>
      `${String(count)} ${count === 1 ? 'card' : 'cards'} in this column`,
    overLimit: 'Over limit',
    /** Friendly empty-board call to action (brand-new team, no cards yet). */
    emptyBoardTitle: 'No work orders yet',
    emptyBoardHint: 'Create your first work order with the New card button above.',
    /** The badge legend (plain-language key to priorities and states). */
    legendButton: 'What do the badges mean?',
    legendTitle: 'Badge guide',
    legendPriorities: 'Priority',
    legendStates: 'Status',
    legendPriorityP0: 'P0 — drop everything',
    legendPriorityP1: 'P1 — high priority',
    legendPriorityP2: 'P2 — normal priority',
    legendBlocked: 'Blocked — stuck on an exception; hover the badge for the reason',
    legendWaiting: 'Waiting — paused on parts or a vendor, with an expected resume date',
    /** Short badge word for the Overdue legend row (the board shows "Overdue: …"). */
    legendOverdueBadge: 'Overdue',
    legendOverdue: 'Overdue — the expected resume date has passed',
    legendCancelled: 'Cancelled / Declined / Duplicate — closed without completing',
    legendArchived: 'Archived — an old Done card, read-only until reopened',
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
    /** Confirmation toasts for the explicit card actions (name the outcome). */
    blockedToast: 'Card blocked',
    unblockedToast: 'Card unblocked',
    cancelledToast: 'Card cancelled — moved to Done',
    reopenedToast: 'Card reopened — moved to Ready',
    /** Always-visible board-card fields with clear placeholders (consistency). */
    noEstimate: 'No estimate',
    unassigned: 'Unassigned',
    noLocation: 'No location',
    locationLabel: (name: string) => `Location: ${name}`,
    attachmentCountLabel: (count: number) =>
      `${String(count)} ${count === 1 ? 'attachment' : 'attachments'}`,
    tagsLabel: (tags: string) => `Tags: ${tags}`,
    resumePrefix: (date: string) => `resume ${date}`,
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
    /** Friendly initial hint (a non-technical user must press Search). */
    initialHint: 'Type part of a card title or description, then press Search.',
    /** Clear no-results wording (distinct from an error). */
    noResults: 'No cards match your search.',
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
    /** Warns that cancelling is destructive-feeling: it leaves the board. */
    consequence: (resolution: string) =>
      `This moves the card to Done and marks it ${resolution}. You can reopen it later from Search.`,
    resolutions: {
      cancelled: 'Cancelled',
      declined: 'Declined',
      duplicate: 'Duplicate',
    } satisfies Record<CancelResolution, string>,
  },

  blockAction: {
    modalTitle: 'Block card',
    reasonLabel: 'What is blocking this card?',
    reasonPlaceholder: 'e.g. Waiting on landlord approval',
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
    descriptionHelp: 'Supports simple formatting — use Preview to check it.',
    priorityLabel: 'Priority',
    estimateLabel: 'Estimate',
    estimateUnitLabel: 'Estimate unit',
    estimateOptional: 'Optional until Ready',
    assigneeLabel: 'Assignee',
    locationLabel: 'Location',
    tagsLabel: 'Tags',
    reporterLabel: 'Reporter',
    createdLabel: 'Created',
    saveFields: 'Save changes',
    fieldsSaved: 'Card updated',
    unsavedWarning: 'You have unsaved changes — click Save changes to keep them.',
    panelLabel: 'Card details',
    closeLabel: 'Close card',
    loadFailed: 'The card could not be loaded.',
    archivedNotice: 'This card is archived — reopen it to make changes.',
    /** The prominent state banner at the top of the panel body. */
    blockedBannerTitle: 'This card is blocked',
    blockedBannerNoReason: 'No reason was given.',
    /** Resolution-specific banner titles — a single "is ${lowercased}" template
     * reads ungrammatically for "duplicate"/"declined", so each terminal
     * resolution gets its own natural phrasing. */
    cancelledBannerTitle: {
      completed: 'This card is completed',
      cancelled: 'This card was cancelled',
      declined: 'This card was declined',
      duplicate: 'This card is a duplicate',
    } satisfies Record<Resolution, string>,
    cancelledBannerBody: 'It sits at the bottom of Done. Reopen it to move it back to Ready.',
    waitingBannerTitle: 'Waiting on Parts / Vendor',
    waitingBannerBody: (reason: string, date: string) =>
      `Paused for ${reason}, expected to resume ${date}. It resumes automatically when moved out of this column.`,
    waitingBannerOverdue: (reason: string, date: string) =>
      `Paused for ${reason}. Expected to resume ${date} — now overdue. It resumes when moved out of this column.`,
  },

  estimateUnits: {
    minutes: 'Minutes',
    hours: 'Hours',
    days: 'Days',
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
    /** Confirmation before an irreversible comment delete (distinct label so
     * the confirm button never collides with the per-comment Delete action). */
    deleteConfirmTitle: 'Delete comment',
    deleteConfirmBody: 'Delete this comment? This cannot be undone.',
    deleteConfirm: 'Delete it',
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
    labelHeader: 'Column',
    labelLabel: 'Column label',
    wipLimitLabel: 'WIP limit',
    wipLimitNone: 'No limit',
    saved: 'Column updated',
    /** Row-scoped confirmation that names which column was saved. */
    savedNamed: (lane: string) => `${lane} updated`,
    rowLabel: (lane: string) => `Column ${lane}`,
  },

  policy: {
    enforcementLabel: 'Enforce workflow transitions',
    enforcementHint:
      'When on, cards may only move along the workflow graph below, and role gates apply.',
    transitionsTitle: 'Workflow graph',
    /** Plain-language help under each heading (dense admin screen). */
    transitionsHint:
      'The allowed moves between columns. When enforcement is off, every move is allowed and these have no effect.',
    disabledWhenOff: 'Turn on enforcement above to use these settings.',
    transitionRowLabel: (from: string, to: string) => `${from} to ${to}`,
    minRoleLabel: 'Minimum role',
    anyRole: 'Any role',
    actionGatesTitle: 'Action gates',
    actionGatesHint:
      'The minimum role for each sensitive action. When enforcement is off, any signed-in user may do all of these.',
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
    intro:
      'Organize your site as buildings, floors, and rooms so work orders can point to where they are.',
    addRoot: 'Add building',
    addFloor: 'Add floor',
    addRoom: 'Add room',
    // Kept stable — the accessible names e2e + unit tests target.
    addChildLabel: (name: string) => `Add inside ${name}`,
    add: 'Add',
    rename: 'Rename',
    renameLabel: (name: string) => `Rename ${name}`,
    deleteLabel: (name: string) => `Delete ${name}`,
    nameLabel: 'Name',
    nameRequired: 'Enter a name',
    addTitle: 'Add location',
    renameTitle: 'Rename location',
    empty: 'No locations yet',
    emptyHint: 'Add your first building to start mapping out your site.',
    treeLabel: 'Location tree',
    kinds: {
      building: 'Building',
      floor: 'Floor',
      room: 'Room',
    } satisfies Record<LocationKind, string>,
    deleteTitle: 'Delete location',
    deleteConfirmBody: (name: string) => `Delete “${name}”?`,
    deleteWarnsDescendants: (name: string) =>
      `Everything inside “${name}” (its floors and rooms) will be removed too. Cards that point here will keep their history but lose their location.`,
    deleteWarnsLeaf: (name: string) =>
      `Cards that point to “${name}” will keep their history but lose their location.`,
    confirmDelete: 'Delete location',
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
    /** Confirmation before revoking (can break a live integration). */
    revokeConfirmTitle: 'Revoke token',
    revokeConfirmBody: (name: string) =>
      `Revoke "${name}"? Any integration using it will stop working immediately. This cannot be undone.`,
    revokeConfirm: 'Revoke token',
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

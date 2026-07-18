import {
  PASSWORD_MIN_LENGTH,
  type CancelResolution,
  type LaneKey,
  type LocationKind,
  type Permission,
  type Priority,
  type Resolution,
  type Theme,
  type TokenScope,
  type WaitingReason,
} from '@rivian-kanban/core'

/**
 * Every user-facing English string lives here (i18n deferral rule: one module
 * to translate later, no literals scattered through components).
 */

export const strings = {
  appTitle: 'Facilities Kanban',

  header: {
    /** Alt text on the logo, which also links home. */
    logoAlt: 'Facilities Kanban — go to the board',
    /** The always-visible board filter in the header centre. */
    searchLabel: 'Filter the board',
    searchPlaceholder: 'Filter cards…',
    searchClear: 'Clear filter',
  },

  common: {
    save: 'Save',
    cancel: 'Cancel',
    create: 'Create',
    delete: 'Delete',
    edit: 'Edit',
    copy: 'Copy',
    copied: 'Copied',
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
    /** Inline rename affordance on a setup location row. */
    renameLocationLabel: (name: string) => `Rename ${name}`,
    renameNameLabel: (name: string) => `New name for ${name}`,
    saveRename: 'Save',
    cancelRename: 'Cancel',
    /** Inline error when a sibling already uses this name (server 409). */
    duplicateName: 'Another location here already has this name. Pick a different name.',
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
    /** Per-lane hint when the header filter hides every card in a lane. */
    filterEmptyLane: 'No matching cards',
    /** Board-level message when the header filter matches nothing anywhere. */
    filterNoMatchesTitle: 'No cards match your filter',
    filterNoMatchesHint:
      'This filters the loaded board only. Archived and closed cards live in full search.',
    /** Subtle per-lane match count shown under the header filter. */
    filterMatchCount: (count: number) => `${String(count)} ${count === 1 ? 'match' : 'matches'}`,
    wipLimitExceededSuffix: 'WIP limit exceeded',
    cardListLabel: (lane: string) => `Cards in ${lane}`,
    loadFailed: 'The board could not be loaded.',
    /** Move confirmation toasts (every move reassures a non-technical user). */
    moved: 'Card moved',
    /** Prefix for the move toast; the destination lane is bolded after it. */
    movedToPrefix: 'Card moved to ',
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
    archivedToast: 'Card archived',
    archive: 'Archive',
    /** Always-visible board-card fields with clear placeholders (consistency). */
    noEstimate: 'No estimate',
    unassigned: 'Unassigned',
    noLocation: 'No location',
    locationLabel: (name: string) => `Location: ${name}`,
    attachmentCountLabel: (count: number) =>
      `${String(count)} ${count === 1 ? 'attachment' : 'attachments'}`,
    tagsLabel: (tags: string) => `Tags: ${tags}`,
    resumePrefix: (date: string) => `resume ${date}`,
    /** Work burn-down bar: business-hours elapsed since In Progress vs the estimate. */
    workProgressLabel: (percent: number) => `Work progress: ${String(percent)}% of the estimate`,
    workProgressTooltip: (elapsed: string, estimate: string) =>
      `${elapsed} of ${estimate} estimated work elapsed (business hours)`,
    workOverdueTooltip: (elapsed: string, estimate: string) =>
      `Overdue — ${elapsed} of work against a ${estimate} estimate`,
  },

  search: {
    /** The advanced-search modal — the one place archived and closed cards are
     * reachable. Opened from the header field's filter icon or the board's
     * no-matches state; replaces the former full-page /search view. */
    modalTitle: 'Search all cards',
    /** aria-label for the header trigger icon and the board no-matches link. */
    advancedButton: 'Advanced search',
    /** Explicit dismiss that names the destination (the modal X does the same). */
    backToBoard: 'Back to board',
    /** Subtle link from the board-filter no-results state into advanced search,
     * carrying the current query so the modal opens pre-populated. */
    searchAllArchived: 'Search all cards, including archived',
    /** Full-width query field: title + description substring. Nothing queries
     * until Search is pressed, so several facets can be set in one pass. */
    queryPlaceholder: 'Search by title or description…',
    /** Stable accessible name for the query input (tests target it). */
    queryAriaLabel: 'Search cards',
    /** Applies the query + facets (a magnifying-glass button + the Enter key). */
    searchButton: 'Search',
    /** Resets every facet to its default and clears the query. */
    clearFilters: 'Clear all',
    /** Collapsible facet section (the search bar stays; only the facets fold). */
    filtersToggle: 'Filters',
    /** aria-labels for the caret that expands/collapses the facet panel. */
    expandFilters: 'Expand filters',
    collapseFilters: 'Collapse filters',
    /** Facet filters (each defaults to "any"). Column maps to the board lane;
     * Tags is multi-select (any-of); Location is recursively inclusive. */
    priorityFilter: 'Priority',
    columnFilter: 'Column',
    tagFilter: 'Tags',
    locationFilter: 'Location',
    anyPriority: 'Any priority',
    anyColumn: 'Any column',
    anyTag: 'Any tag',
    anyLocation: 'Any location',
    /** Archived-scope combobox (matches the other facet selects): a 3-way choice
     * defaulting to both, so archived cards are in scope (docs/user/guide.md). */
    archivedFilter: 'Archived cards',
    archivedBoth: 'Active and archived',
    activeOnly: 'Active cards only',
    archivedOnly: 'Archived only',
    resultsLabel: 'Search results',
    /** Count summary above the results list. */
    resultCount: (count: number) => `${String(count)} ${count === 1 ? 'result' : 'results'}`,
    /** Clear no-results wording (distinct from an error). */
    noResults: 'No cards match your search.',
    loadFailed: 'Cards could not be loaded.',
  },

  move: {
    modalTitle: 'Move card',
    laneLabel: 'Column',
    positionLabel: 'Position',
    positionFirst: 'First (top)',
    positionLast: 'Last (bottom)',
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
    commentLabel: 'Note (optional)',
    commentPlaceholder: 'Add context — which part, vendor, or PO number',
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
    descriptionHelp: 'Rich text — bold, headings, lists, and links. Stored as markdown.',
    priorityLabel: 'Priority',
    /** Unmistakable that this is the estimated time to finish the work (ITEM 3). */
    estimateLabel: 'Estimated time to completion',
    estimateUnitLabel: 'Time unit',
    estimateUnitHelp:
      'Enter the estimate in minutes, hours, or days. One day means 8 working hours.',
    estimateOptional: 'How long the work should take. Optional until Ready.',
    assigneeLabel: 'Assignee',
    locationLabel: 'Location',
    tagsLabel: 'Tags',
    reporterLabel: 'Reporter',
    createdLabel: 'Created',
    updatedLabel: 'Updated',
    saveFields: 'Save changes',
    fieldsSaved: 'Card updated',
    unsavedWarning: 'You have unsaved changes — click Save changes to keep them.',
    panelLabel: 'Card details',
    closeLabel: 'Close card',
    /** Accessible name for the panel's drag-to-resize handle (also arrow-key aware). */
    resizeLabel: 'Resize the detail panel — drag, or use the arrow keys',
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
    /** Inline edit of the waiting reason + resume date while the card waits. */
    waitingEditHint: 'Update the reason or expected resume date without moving the card.',
    waitingReasonLabel: 'Waiting reason',
    waitingResumeLabel: 'Expected resume date',
    waitingSave: 'Save',
    waitingOverdueNote: 'This card is overdue — pick a new expected resume date.',
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
    actorOnBehalfOf: (token: string, user: string) => `${token} on behalf of ${user}`,
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
    /** Avatar-menu item that opens the Settings page (every role). */
    menuItem: 'Settings',
    tabPreferences: 'Preferences',
    tabUsers: 'Users',
    tabLanes: 'Columns',
    tabPolicy: 'Permissions',
    tabLocations: 'Locations',
    tabTokens: 'Service tokens',
  },

  // The per-user preferences fields (time zone + theme), now the first Settings
  // tab every role sees. Kept under `profile.*` so the field copy stays in one
  // place regardless of where the controls are mounted.
  profile: {
    title: 'Preferences',
    timezoneLabel: 'Time zone',
    timezoneHelp: 'Dates and times across the app are shown in this time zone.',
    timezoneNothingFound: 'No matching time zone',
    themeLabel: 'Theme',
    themeHelp: 'Choose light or dark, or follow your system setting.',
    themes: {
      light: 'Light',
      dark: 'Dark',
      system: 'System',
    } satisfies Record<Theme, string>,
    saved: 'Preferences saved',
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
    matrixTitle: 'Roles & permissions',
    matrixHint:
      'Each role grants the permissions ticked below. Unticked = not allowed (nothing is granted unless you tick it). Add roles and assign them to people and tokens from the Users and Service tokens tabs.',
    /** Accessible name for the whole matrix table. */
    matrixLabel: 'Roles and permissions matrix',
    /** Sticky header cell over the permission-label column. */
    permissionColumnHeader: 'Permission',
    /** Per (role, permission) checkbox accessible name. */
    cellLabel: (role: string, permission: string) => `${permission} for ${role}`,
    addRole: 'Add role',
    addRoleTitle: 'Add role',
    roleKeyLabel: 'Key',
    roleKeyHint: 'Lowercase letters, numbers, and underscores. Cannot be changed later.',
    roleKeyInvalid: 'Use lowercase letters, numbers, and underscores; start with a letter.',
    roleKeyTaken: 'A role with this key already exists.',
    roleNameLabel: 'Display name',
    roleNameRequired: 'Enter a role name',
    roleMenuLabel: (role: string) => `Options for ${role}`,
    renameRole: 'Rename',
    renameRoleTitle: 'Rename role',
    deleteRole: 'Delete role',
    deleteRoleTitle: 'Delete role',
    deleteRoleConfirm: (role: string) => `Delete the “${role}” role?`,
    /** Inline error when the server rejects deleting a role still assigned (409). */
    roleInUse: 'This role is still assigned to a user or token. Reassign them first.',
    /** Guardrail: the last role that can manage roles cannot lose that power. */
    lastManageRoles: 'At least one role must be able to manage roles & permissions.',
    enforcementLabel: 'Enforce workflow transitions',
    enforcementHint: 'When on, cards may only move between columns along the workflow graph below.',
    transitionsTitle: 'Workflow graph',
    /** Plain-language help under each heading (dense admin screen). */
    transitionsHint:
      'The allowed moves between columns. When enforcement is off, every move is allowed and these have no effect.',
    disabledWhenOff: 'Turn on enforcement above for this to take effect.',
    transitionRowLabel: (from: string, to: string) => `${from} to ${to}`,
    saved: 'Policy updated',
    /** Human labels for each permission, grouped into admin-legible sections. */
    sections: {
      cards: 'Work cards',
      commentsFiles: 'Comments & files',
      administration: 'Administration',
    },
    permissions: {
      'card.create': 'Create cards',
      'card.update': 'Edit cards',
      'card.move': 'Move cards between columns',
      'card.block': 'Block cards',
      'card.unblock': 'Unblock cards',
      'card.cancel': 'Cancel cards',
      'card.reopen': 'Reopen cards',
      'card.archive': 'Archive cards',
      'comment.add': 'Add comments',
      'comment.deleteOthers': 'Delete others’ comments',
      'attachment.add': 'Upload files',
      'attachment.deleteOthers': 'Delete others’ files',
      manageUsers: 'Manage users',
      manageRoles: 'Manage roles & permissions',
      manageLocations: 'Manage locations',
      manageLanes: 'Manage columns',
      managePolicy: 'Edit workflow policy',
      manageTokens: 'Manage API tokens',
    } satisfies Record<Permission, string>,
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
    /** Inline error when a sibling already uses this name (server 409). */
    duplicateName: 'Another location here already has this name. Pick a different name.',
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
    rotate: 'Rotate',
    /** Confirmation before rotating (the old secret dies immediately). */
    rotateConfirmTitle: 'Rotate token',
    rotateConfirmBody: (name: string) =>
      `Rotate "${name}"? Its current token stops working immediately — any integration using it must be updated with the new one.`,
    rotateConfirm: 'Rotate token',
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

  /**
   * The single source of plain-language priority meanings, consumed by BOTH the
   * priority Select (bold "P0 — {name}" + dimmed {description}) and the badge
   * guide (badge + "{name} — {description}") so the two can never drift.
   */
  priorityOptions: {
    P0: { name: 'Critical', description: 'Drop everything' },
    P1: { name: 'High', description: 'Do soon' },
    P2: { name: 'Normal', description: 'Routine work' },
  } satisfies Record<Priority, { name: string; description: string }>,

  resolutions: {
    completed: 'Completed',
    cancelled: 'Cancelled',
    declined: 'Declined',
    duplicate: 'Duplicate',
  } satisfies Record<Resolution, string>,
} as const

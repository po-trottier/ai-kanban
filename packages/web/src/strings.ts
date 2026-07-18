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
    /** Tooltip on the avatar button that opens the account menu (settings + log out). */
    accountMenu: 'Account menu',
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

  /**
   * Hover/focus hints on interactive controls: the always-shown purpose of a
   * button (context, not a bare echo of the label — shortcuts where they exist)
   * and the reason a disabled control can't be used right now. Grouped so a
   * screen's copy stays in one place.
   */
  tooltips: {
    // Generic reusable hints/reasons.
    cancelDialog: 'Close this dialog without saving',
    loadMore: 'Load the next page of results',
    disabledEmptyName: 'Enter a name first',
    // Auth.
    signIn: 'Sign in to the board with your email and password',
    changePassword: 'Set your new password and continue to the board',
    createAdmin: 'Create the first administrator account and sign in',
    // Setup wizard.
    setupSkip: 'Skip adding locations for now — set them up later in Settings',
    setupContinue: 'Finish setup and open the board',
    setupRemoveConfirm: 'Remove this location permanently',
    // Board / cards.
    newCard: 'Create a new work order — it lands in Intake',
    createCard: 'Create the work order in Intake',
    openCard: 'Open this card’s details',
    move: 'Move the card to a chosen column and position',
    block: 'Flag the card as blocked with a reason',
    cancelCard: 'Close the card as cancelled, declined, or a duplicate',
    reopen: 'Reopen the card and move it back to Ready',
    unblock: 'Clear the block and let the card move again',
    archive: 'Archive this Done card — read-only until reopened',
    saveCard: 'Save your edits to this card',
    saveWaiting: 'Save the updated waiting reason or resume date',
    // Disabled reasons (WHY a control is off).
    disabledMoveNotAllowed: 'This column can’t be entered from the current one',
    disabledWaitingIncomplete: 'Pick a waiting reason and resume date first',
    disabledReopenNoPermission: 'You don’t have permission to reopen cards',
    disabledArchiveNoPermission: 'You don’t have permission to archive cards',
    disabledCancelNoPermission: 'You don’t have permission to cancel cards',
    disabledUnblockNotBlocked: 'This card isn’t blocked',
    disabledNoChanges: 'Nothing to save yet — edit a field first',
    // Comments.
    comment: 'Post this comment on the card',
    postReply: 'Post your reply in this thread',
    replyComment: 'Reply to this comment',
    editComment: 'Edit your comment',
    deleteComment: 'Delete this comment',
    saveCommentEdit: 'Save your changes to this comment',
    disabledEmptyComment: 'Write something before posting',
    // Attachments.
    browseFiles: 'Choose an image or PDF to attach',
    // Users admin.
    newUser: 'Invite a new user with a temporary password',
    resetPassword: 'Issue a new one-time temporary password',
    deactivateUser: 'Deactivate this user so they can no longer sign in',
    createUser: 'Create the user and reveal their temporary password',
    disabledUserFields: 'Enter a display name and email first',
    // Tokens admin.
    newToken: 'Create a service token for API / MCP access',
    rotateToken: 'Replace the token’s secret — the old one stops working',
    revokeToken: 'Revoke the token so it can no longer authenticate',
    createToken: 'Create the token and reveal its secret once',
    // Lanes admin.
    saveLane: 'Save this column’s label and WIP limit',
    // Policy admin.
    addRole: 'Add a new role to the permissions matrix',
    savePolicy: 'Save the roles, permissions, and workflow policy',
    renameRole: 'Rename this role',
    deleteRole: 'Delete this role',
    createRole: 'Add the role to the matrix',
    disabledRoleFields: 'Enter a valid, unused key and a display name',
    disabledRoleNameRequired: 'Enter a role name first',
    disabledDeleteRoleLast: 'At least one role must keep permission to manage roles',
    // Locations admin.
    addBuilding: 'Add a building to your site',
    saveLocation: 'Save this location’s name',
    setupAddBuilding: 'Add a building to your site',
    setupAddFloor: 'Add a floor to this building',
    setupAddRoom: 'Add a room to this floor',
    // Preferences.
    savePreferences: 'Save your time zone and theme',
    // Account / shell.
    settings: 'Open Settings',
    logout: 'Sign out of Facilities Kanban',
    home: 'Go to the board',
    reload: 'Reload the page',
  },

  /**
   * Plain-language help shown on a field's info icon (the FieldLabel pattern) —
   * so a non-technical facilities user understands each input. The PO flagged
   * location, estimate, and priority as the must-haves; the rest keep the
   * pattern consistent across every form field.
   */
  fieldHelp: {
    title: 'A short, specific summary of the work — e.g. “Replace lobby light ballast”.',
    priority:
      'How urgent the work is: P0 Critical (drop everything), P1 High (do soon), P2 Normal (routine).',
    estimate:
      'Roughly how long the work should take — the target completion time, used for the burn-down bar.',
    assignee: 'The person responsible for doing the work. Leave empty to keep it unassigned.',
    reporter: 'Who filed this work order. Set automatically and not editable.',
    tags: 'Free-form keywords for grouping and searching — e.g. plumbing, electrical.',
    location: 'Where the work is — the building, floor, or room it points to.',
    wipLimit: 'The most cards allowed in this column at once. Leave empty for no limit.',
    roleKey: 'The internal identifier for the role. Lowercase, and fixed once created.',
    roleName: 'The human-readable name shown throughout the app.',
    permissionCell: 'Tick to grant this permission to the role. Unticked means not allowed.',
    tokenName: 'A label to recognise this token by — e.g. “Slack bot” or “Nightly sync”.',
    tokenRole: 'The role whose permissions the token acts with.',
    tokenScope: 'Read-only tokens can’t change anything; read + write can.',
    timezone: 'Dates and times across the app are shown in this time zone.',
    theme: 'Choose light or dark, or follow your system setting.',
  },

  /** Global keyboard undo/redo of non-text board actions (ITEM 86). */
  undo: {
    /** Announced after an undo/redo — the label names what was reversed. */
    undone: (label: string) => `Undone: ${label}`,
    redone: (label: string) => `Redone: ${label}`,
    nothingToUndo: 'Nothing to undo',
    nothingToRedo: 'Nothing to redo',
    /** Shown when an inverse is no longer permitted or possible (RBAC / stale). */
    cannotUndo: "Can't undo that",
    cannotRedo: "Can't redo that",
    /** Entry labels (what the toast names). */
    moveLabel: 'card move',
    cancelLabel: 'card cancellation',
    reopenLabel: 'card reopen',
    archiveLabel: 'card archive',
    blockLabel: 'card block',
    unblockLabel: 'card unblock',
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
    /** Per-lane hint when the filter bar hides every card in a lane. */
    filterEmptyLane: 'No matching cards',
    /** Subtle per-lane match count shown while the filter bar is narrowing. */
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
    legendWaiting: 'Waiting — on parts or a vendor, with a date it is expected to resume',
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
    /** Priority chip hover — the same plain-language meaning the picker shows. */
    priorityBadgeTooltip: (name: string, meaning: string) => `${name} — ${meaning}`,
    waitingBadge: (reason: string) => `Waiting: ${reason}`,
    overdueBadge: (reason: string) => `Overdue: ${reason}`,
    archivedBadge: 'Archived',
    /** Hover explanations for the color-only status badges (mirrors the legend
     * copy) so a technician never has to open the badge guide to decode them. */
    waitingBadgeTooltip: (reason: string, date: string) =>
      `Waiting on ${reason} — expected to resume by ${date}.`,
    overdueBadgeTooltip: (reason: string, date: string) =>
      `Waiting on ${reason} — overdue: the expected resume date (${date}) has passed.`,
    cancelledBadgeTooltip: (resolution: string) =>
      `Closed as ${resolution} — filter the board to All to find it and reopen it.`,
    archivedBadgeTooltip: 'Archived — an old Done card, read-only until reopened.',
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
    /** Estimate chip hover — what the compact "2h"/"1d" figure means. */
    estimateTooltip: (estimate: string) => `Estimated time to complete: ${estimate}`,
    unassigned: 'Unassigned',
    noLocation: 'No location',
    locationLabel: (name: string) => `Location: ${name}`,
    attachmentCountLabel: (count: number) =>
      `${String(count)} ${count === 1 ? 'attachment' : 'attachments'}`,
    tagsLabel: (tags: string) => `Tags: ${tags}`,
    resumePrefix: (date: string) => `resume ${date}`,
    /** Work burn-down bar: business-hours elapsed since In Progress vs the estimate. */
    workProgressLabel: (percent: number) => `Work progress: ${String(percent)}% of the estimate`,
    /** Short RUNNING / PAUSED chip on the bar — what the clock is doing right now. */
    timerRunning: 'Running',
    timerPaused: 'Paused',
    /** The "why", read out after the chip and in the tooltip's first line. */
    timerReason: {
      working: 'counting work time',
      waiting: 'waiting on parts/vendor — clock still counting',
      blocked: 'card is blocked — clock still counting',
      off_hours: 'outside business hours',
    },
    /** Tooltip: the timer line, the elapsed-vs-estimate line, and the accrual window. */
    workProgressTooltip: (state: string, elapsed: string, estimate: string) =>
      `${state}. ${elapsed} of ${estimate} estimated work elapsed. Time accrues only during business hours (Mon–Fri, 9am–5pm in your time zone).`,
    workOverdueTooltip: (state: string, elapsed: string, estimate: string) =>
      `${state}. Overdue — ${elapsed} of work against a ${estimate} estimate. Time accrues only during business hours (Mon–Fri, 9am–5pm in your time zone).`,
  },

  /**
   * The board FILTER BAR (below the header, above the board) — every facet of
   * the shared `BoardFilter`, its presets, and the save/rename/delete flow.
   * Every control here reads as part of one bar; the enumerable facets are
   * split segmented controls, the high-cardinality ones multi-select pills.
   */
  filterBar: {
    /** Accessible name for the whole bar region. */
    regionLabel: 'Board filters',
    /**
     * The bar is placeholder-only (no visible field labels), so every control
     * carries an `aria-label` (the `*Label` strings) for its accessible name
     * (convention #104) plus a `placeholder` for the visible cue.
     */
    queryLabel: 'Filter cards',
    queryPlaceholder: 'Search cards…',
    queryClear: 'Clear the text filter',
    /** Any-of enumerable facets, rendered as MultiSelect pill dropdowns. */
    priorityLabel: 'Priority',
    priorityGroupLabel: 'Filter by priority',
    priorityPlaceholder: 'Priority',
    laneLabel: 'Status',
    laneGroupLabel: 'Filter by status',
    lanePlaceholder: 'Status',
    scopeLabel: 'Scope',
    scopeGroupLabel: 'Active, archived, or all cards',
    scopeActive: 'Active',
    scopeArchived: 'Archived',
    scopeAll: 'All',
    /** The overdue toggle (a two-segment control: everything vs overdue-only). */
    overdueLabel: 'Overdue',
    overdueAny: 'Any',
    overdueOnly: 'Overdue',
    /** High-cardinality facet multi-selects (any-of). */
    assigneeLabel: 'Assignee',
    assigneePlaceholder: 'Assignee',
    reporterLabel: 'Reporter',
    reporterPlaceholder: 'Reporter',
    tagsLabel: 'Tags',
    tagsPlaceholder: 'Tags',
    locationsLabel: 'Location',
    locationsPlaceholder: 'Location',
    /** Resets every facet back to the empty filter (today's full board). */
    clearAll: 'Reset filters',
    /** Presets combobox: built-ins + the user's saved filters. */
    presetsLabel: 'Preset',
    presetsPlaceholder: 'Choose a preset',
    presetsBuiltInGroup: 'Built-in',
    presetsCustomGroup: 'My presets',
    /** Trailing dropdown action that opens the save-preset flow. */
    presetsCreateGroup: 'Actions',
    presetsCreate: 'Create new preset',
    /** Built-in preset display names (mirror core BUILTIN_FILTER_PRESETS). */
    builtinMyCards: 'My Cards',
    builtinOverdue: 'Overdue',
    /** Save / rename / delete affordances. */
    savePreset: 'Save current filters as a preset',
    savePresetTitle: 'Save filter preset',
    presetNameLabel: 'Preset name',
    presetNamePlaceholder: 'e.g. My urgent HVAC jobs',
    saveConfirm: 'Save preset',
    renamePreset: 'Rename this preset',
    renamePresetTitle: 'Rename preset',
    renameConfirm: 'Rename',
    deletePreset: 'Delete this preset',
    deletePresetTitle: 'Delete preset',
    deletePresetConfirm: (name: string) => `Delete the “${name}” preset?`,
    deleteConfirm: 'Delete preset',
    /** Toasts confirming a preset mutation. */
    presetSaved: 'Preset saved',
    presetRenamed: 'Preset renamed',
    presetDeleted: 'Preset deleted',
    /** Tooltips (every control carries one). */
    tooltips: {
      query: 'Show only cards whose title or description contains this text',
      priority: 'Show only cards at the selected priorities',
      lane: 'Show only cards in the selected columns',
      scope: 'Include active cards, archived cards, or both',
      overdue: 'Show only cards past their estimated completion time',
      assignee: 'Show only cards assigned to the selected people',
      reporter: 'Show only cards filed by the selected people',
      tags: 'Show only cards carrying at least one of these tags',
      locations: 'Show only cards at the selected locations (buildings include their rooms)',
      clearAll: 'Reset every filter to the full board',
      presets: 'Apply a saved filter — it replaces every facet at once',
      savePreset: 'Save the current filters as a named preset you can reapply',
      renamePreset: 'Give this preset a new name',
      deletePreset: 'Remove this saved preset',
      disabledEmptyPresetName: 'Enter a preset name first',
    },
    /** Board-level message when the filter matches nothing anywhere. */
    noMatchesTitle: 'No cards match your filters',
    noMatchesHint: 'Widen the scope or clear a facet to see more cards.',
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
      `This moves the card to Done and marks it ${resolution}. You can reopen it later — filter the board to All to find it.`,
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
    descriptionHelp:
      'The full details of the work — what needs doing, where, and any useful context. Rich text with headings, lists, and links; stored as markdown.',
    priorityLabel: 'Priority',
    /** Unmistakable that this is the estimated time to finish the work (ITEM 3). */
    estimateLabel: 'Estimated time to completion',
    estimateUnitLabel: 'Time unit',
    estimateUnitHelp:
      'Enter the estimate in minutes, hours, or days. One day means 8 working hours.',
    estimateOptional: 'How long the work should take. Optional until Ready.',
    /** Toggle between typing a duration and picking a target completion date. */
    estimateModeDuration: 'Enter time',
    estimateModeDate: 'Target date',
    estimateModeLabel: 'How to set the estimate',
    estimateDateLabel: 'Target completion date',
    /** Derived-estimate hint under the date picker (business-hours conversion). */
    estimateDateHelp:
      'The estimate is the working time (Mon–Fri, 9am–5pm) between now and this date.',
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
      `Waiting on ${reason}, expected to resume by ${date}. It resumes automatically when moved out of this column.`,
    waitingBannerOverdue: (reason: string, date: string) =>
      `Waiting on ${reason}. Expected to resume by ${date} — now overdue. It resumes when moved out of this column.`,
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
    // Mirrors the enforced upload caps (core: ALLOWED_ATTACHMENT_MIME_TYPES,
    // MAX_ATTACHMENT_BYTES, MAX_ACTIVE_ATTACHMENTS_PER_CARD).
    sectionHelp: 'Photos and PDFs of the work — up to 25 MB each, 10 files per card.',
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
    /** Subtle context on a reply: which comment (its author) it answers. */
    repliedTo: (name: string) => `Replied to ${name}`,
    /** Parent is present in the page but soft-deleted (blanked body). */
    repliedToDeleted: 'Replied to a deleted comment',
    /** Parent isn't in the loaded page (older than the fetched window). */
    repliedToEarlier: 'Replied to an earlier comment',
    /** Accessible name for the reply-context button that jumps to the parent. */
    repliedToLabel: (name: string) => `Go to the comment by ${name} this replies to`,
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
      viewAllActivity: 'View all activity',
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

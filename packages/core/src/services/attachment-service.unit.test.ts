import { describe, expect, it } from 'vitest'
import { MAX_ACTIVE_ATTACHMENTS_PER_CARD, MAX_ATTACHMENT_BYTES } from '../domain/constants.ts'
import {
  ArchivedError,
  LimitExceededError,
  NotFoundError,
  PolicyDeniedError,
} from '../domain/errors.ts'
import { DEFAULT_POLICY_DOCUMENT } from '../domain/policy.ts'
import { createScenario, fixtureId, type Scenario } from '../testing/index.ts'

const SHA = 'a'.repeat(64)

function uploadInput(bytes = 3) {
  return {
    filename: 'photo.png',
    mime: 'image/png',
    content: new Uint8Array(bytes),
    sha256: SHA,
  }
}

function seedAttachments(scenario: Scenario, cardId: string, active: number, deleted = 0) {
  for (let i = 0; i < active + deleted; i += 1) {
    scenario.db.seedAttachment({
      id: fixtureId(800 + i),
      cardId,
      filename: `file-${i.toString()}.png`,
      mime: 'image/png',
      bytes: 10,
      sha256: SHA,
      storageKey: fixtureId(850 + i),
      uploadedBy: scenario.users.technician.id,
      createdAt: '2026-07-01T00:00:00.000Z',
      deletedAt: i < active ? null : '2026-07-02T00:00:00.000Z',
    })
  }
}

describe('AttachmentService.add', () => {
  it('stores the blob under a random key and the metadata row with an audit event', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()

    // Act
    const attachment = await scenario.attachments.add(
      scenario.actors.technician,
      card.id,
      uploadInput(5),
    )

    // Assert
    expect(scenario.blobStore.blobs.has(attachment.storageKey)).toBe(true)
    expect(scenario.db.getAttachment(attachment.id)).toMatchObject({
      filename: 'photo.png',
      bytes: 5,
      uploadedBy: scenario.actors.technician.id,
      deletedAt: null,
    })
    expect(scenario.db.eventsFor(card.id).at(0)).toMatchObject({
      eventType: 'attachment.added',
      payload: { attachmentId: attachment.id, filename: 'photo.png' },
    })
  })

  it('rejects a file over 25 MB without storing anything', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()

    // Act
    const act = scenario.attachments.add(
      scenario.actors.technician,
      card.id,
      uploadInput(MAX_ATTACHMENT_BYTES + 1),
    )

    // Assert
    await expect(act).rejects.toBeInstanceOf(LimitExceededError)
    await expect(act).rejects.toMatchObject({ limit: MAX_ATTACHMENT_BYTES })
    expect(scenario.blobStore.blobs.size).toBe(0)
  })

  it('rejects the 11th active attachment and cleans the blob up', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()
    seedAttachments(scenario, card.id, MAX_ACTIVE_ATTACHMENTS_PER_CARD)

    // Act
    const act = scenario.attachments.add(scenario.actors.technician, card.id, uploadInput())

    // Assert
    await expect(act).rejects.toBeInstanceOf(LimitExceededError)
    await expect(act).rejects.toMatchObject({ limit: MAX_ACTIVE_ATTACHMENTS_PER_CARD })
    expect(scenario.blobStore.blobs.size).toBe(0)
    expect(scenario.db.eventsFor(card.id)).toHaveLength(0)
  })

  it('does not count soft-deleted attachments toward the cap', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()
    seedAttachments(scenario, card.id, MAX_ACTIVE_ATTACHMENTS_PER_CARD - 1, 5)

    // Act
    const attachment = await scenario.attachments.add(
      scenario.actors.technician,
      card.id,
      uploadInput(),
    )

    // Assert
    expect(scenario.db.getAttachment(attachment.id).deletedAt).toBeNull()
  })

  it('treats archived cards as read-only and cleans the blob up', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({
      laneId: scenario.lanes.done.id,
      resolution: 'completed',
      archivedAt: '2026-04-01T00:00:00.000Z',
    })

    // Act
    const act = scenario.attachments.add(scenario.actors.technician, card.id, uploadInput())

    // Assert
    await expect(act).rejects.toBeInstanceOf(ArchivedError)
    expect(scenario.blobStore.blobs.size).toBe(0)
  })

  it('propagates the domain error even when the cleanup delete itself fails', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({
      laneId: scenario.lanes.done.id,
      resolution: 'completed',
      archivedAt: '2026-04-01T00:00:00.000Z',
    })
    scenario.blobStore.failNextDelete = true

    // Act
    const act = scenario.attachments.add(scenario.actors.technician, card.id, uploadInput())

    // Assert — a 409-shaped domain error, never the masked blob-store error
    await expect(act).rejects.toBeInstanceOf(ArchivedError)
    expect(scenario.blobStore.failNextDelete).toBe(false)
  })

  it('rejects an uploader whose actor id resolves to no user (uploaded_by is a user FK)', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()

    // Act
    const act = scenario.attachments.add(scenario.actors.mcpReadWrite, card.id, uploadInput())

    // Assert
    await expect(act).rejects.toBeInstanceOf(NotFoundError)
    await expect(act).rejects.toMatchObject({ resource: 'uploader' })
    expect(scenario.blobStore.blobs.size).toBe(0)
  })
})

describe('AttachmentService.remove', () => {
  it('soft-deletes the row, deletes the blob, and audits attachment.removed', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()
    const attachment = await scenario.attachments.add(
      scenario.actors.technician,
      card.id,
      uploadInput(),
    )

    // Act
    const removed = await scenario.attachments.remove(scenario.actors.technician, attachment.id)

    // Assert
    expect(removed.deletedAt).not.toBeNull()
    expect(scenario.blobStore.blobs.has(attachment.storageKey)).toBe(false)
    expect(scenario.db.eventsFor(card.id).at(-1)).toMatchObject({
      eventType: 'attachment.removed',
      payload: { attachmentId: attachment.id, filename: 'photo.png' },
    })
  })

  it('reports the committed soft-delete and hints even when the blob delete fails', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()
    const attachment = await scenario.attachments.add(
      scenario.actors.technician,
      card.id,
      uploadInput(),
    )
    scenario.blobStore.failNextDelete = true

    // Act — blob removal is best-effort; an orphaned blob beats a false failure
    const removed = await scenario.attachments.remove(scenario.actors.technician, attachment.id)

    // Assert
    expect(removed.deletedAt).not.toBeNull()
    expect(scenario.db.getAttachment(attachment.id).deletedAt).not.toBeNull()
    expect(scenario.blobStore.blobs.has(attachment.storageKey)).toBe(true)
    expect(scenario.eventBus.published.at(-1)?.type).toBe('attachment.removed')
  })

  it('applies the deleteOthersAttachments gate to non-uploaders only', async () => {
    // Arrange
    const scenario = createScenario({
      policy: { ...DEFAULT_POLICY_DOCUMENT, actionGates: { deleteOthersAttachments: 'admin' } },
    })
    const card = scenario.seedCard()
    const attachment = await scenario.attachments.add(
      scenario.actors.technician,
      card.id,
      uploadInput(),
    )

    // Act — a different non-uploader below the gate (both are role `user`)
    const denied = scenario.attachments.remove(scenario.actors.requester, attachment.id)

    // Assert
    await expect(denied).rejects.toBeInstanceOf(PolicyDeniedError)
    await expect(denied).rejects.toMatchObject({ rule: 'actionGates.deleteOthersAttachments' })
    expect(scenario.db.getAttachment(attachment.id).deletedAt).toBeNull()
  })

  it('lets the uploader remove their own file despite the gate', async () => {
    // Arrange
    const scenario = createScenario({
      policy: { ...DEFAULT_POLICY_DOCUMENT, actionGates: { deleteOthersAttachments: 'admin' } },
    })
    const card = scenario.seedCard()
    const attachment = await scenario.attachments.add(
      scenario.actors.technician,
      card.id,
      uploadInput(),
    )

    // Act
    const removed = await scenario.attachments.remove(scenario.actors.technician, attachment.id)

    // Assert
    expect(removed.deletedAt).not.toBeNull()
  })

  it('rejects removing an already-removed attachment', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()
    const attachment = await scenario.attachments.add(
      scenario.actors.technician,
      card.id,
      uploadInput(),
    )
    await scenario.attachments.remove(scenario.actors.technician, attachment.id)

    // Act
    const act = scenario.attachments.remove(scenario.actors.technician, attachment.id)

    // Assert
    await expect(act).rejects.toBeInstanceOf(NotFoundError)
  })
})

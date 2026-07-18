import { type Attachment } from '@rivian-kanban/core'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fixtureAdmin, fixtureTech, makeCard, uid } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { AttachmentsSection } from './AttachmentsSection.tsx'

const card = makeCard('ready')

function makeAttachment(overrides: Partial<Attachment> & Pick<Attachment, 'id'>): Attachment {
  return {
    cardId: card.id,
    filename: 'photo.png',
    mime: 'image/png',
    bytes: 1024,
    sha256: 'a'.repeat(64),
    storageKey: uid(97),
    uploadedBy: fixtureAdmin.id,
    createdAt: '2026-07-01T10:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

const noop = () => undefined

describe('AttachmentsSection', () => {
  it('renders image thumbnails via the download URL and names for PDFs', () => {
    // Arrange
    const image = makeAttachment({ id: uid(101) })
    const pdf = makeAttachment({ id: uid(102), filename: 'quote.pdf', mime: 'application/pdf' })
    // Act
    renderWithProviders(
      <AttachmentsSection
        attachments={[image, pdf]}
        currentUserId={fixtureAdmin.id}
        canDeleteOthers={false}
        uploading={false}
        onUpload={noop}
        onDelete={noop}
      />,
    )
    // Assert
    expect(screen.getByRole('img', { name: 'photo.png' })).toHaveAttribute(
      'src',
      `/api/v1/attachments/${image.id}`,
    )
    expect(screen.getByText('quote.pdf')).toBeInTheDocument()
  })

  it('explains what can be attached with an info tooltip on the section label', () => {
    // Arrange
    const attachments: Attachment[] = []
    // Act
    renderWithProviders(
      <AttachmentsSection
        attachments={attachments}
        currentUserId={fixtureAdmin.id}
        canDeleteOthers={false}
        uploading={false}
        onUpload={noop}
        onDelete={noop}
      />,
    )
    // Assert — the FieldLabel info button carries the caps as its accessible name.
    expect(screen.getByRole('button', { name: /25 MB each/ })).toBeInTheDocument()
  })

  it('shows the empty state without attachments', () => {
    // Arrange
    const attachments: Attachment[] = []
    // Act
    renderWithProviders(
      <AttachmentsSection
        attachments={attachments}
        currentUserId={fixtureAdmin.id}
        canDeleteOthers={false}
        uploading={false}
        onUpload={noop}
        onDelete={noop}
      />,
    )
    // Assert
    expect(screen.getByText('No attachments yet')).toBeInTheDocument()
  })

  it('uploads a picked file and deletes via the per-file action', async () => {
    // Arrange
    const user = userEvent.setup()
    const uploaded: File[] = []
    const deleted: string[] = []
    const image = makeAttachment({ id: uid(103) })
    renderWithProviders(
      <AttachmentsSection
        attachments={[image]}
        currentUserId={fixtureAdmin.id}
        canDeleteOthers={false}
        uploading={false}
        onUpload={(file) => uploaded.push(file)}
        onDelete={(id) => deleted.push(id)}
      />,
    )
    // Act
    const file = new File(['png-bytes'], 'after.png', { type: 'image/png' })
    const input = screen.getByLabelText<HTMLInputElement>('Browse files')
    await user.upload(input, file)
    await user.click(screen.getByRole('button', { name: 'Delete photo.png' }))
    // Assert
    expect(uploaded.map((f) => f.name)).toEqual(['after.png'])
    expect(deleted).toEqual([image.id])
  })

  it('uploads every file when several are picked at once', async () => {
    // Arrange
    const user = userEvent.setup()
    const uploaded: File[] = []
    renderWithProviders(
      <AttachmentsSection
        attachments={[]}
        currentUserId={fixtureAdmin.id}
        canDeleteOthers={false}
        uploading={false}
        onUpload={(file) => uploaded.push(file)}
        onDelete={noop}
      />,
    )
    // Act — a multi-select of three valid files
    const files = [
      new File(['a'], 'one.png', { type: 'image/png' }),
      new File(['b'], 'two.jpg', { type: 'image/jpeg' }),
      new File(['c'], 'three.pdf', { type: 'application/pdf' }),
    ]
    const input = screen.getByLabelText<HTMLInputElement>('Browse files')
    await user.upload(input, files)
    // Assert — each survivor is handed to onUpload once
    expect(uploaded.map((f) => f.name)).toEqual(['one.png', 'two.jpg', 'three.pdf'])
  })

  it('rejects the whole batch when it would exceed the 10-per-card cap', async () => {
    // Arrange — card already holds 9 attachments, so 2 more overflows
    const user = userEvent.setup()
    const uploaded: File[] = []
    const existing = Array.from({ length: 9 }, (_, i) => makeAttachment({ id: uid(200 + i) }))
    renderWithProviders(
      <AttachmentsSection
        attachments={existing}
        currentUserId={fixtureAdmin.id}
        canDeleteOthers={false}
        uploading={false}
        onUpload={(file) => uploaded.push(file)}
        onDelete={noop}
      />,
    )
    // Act
    const files = [
      new File(['a'], 'ten.png', { type: 'image/png' }),
      new File(['b'], 'eleven.png', { type: 'image/png' }),
    ]
    const input = screen.getByLabelText<HTMLInputElement>('Browse files')
    await user.upload(input, files)
    // Assert — nothing uploaded, a clear message shown
    expect(uploaded).toEqual([])
    expect(await screen.findByText(/at most 10 attachments/)).toBeInTheDocument()
  })

  it('skips oversized and wrong-type files, uploading only the valid ones', async () => {
    // Arrange — applyAccept off so the disallowed type reaches our own guard
    // (drops bypass the input's `accept`, and browsers don't strictly enforce it).
    const user = userEvent.setup({ applyAccept: false })
    const uploaded: File[] = []
    renderWithProviders(
      <AttachmentsSection
        attachments={[]}
        currentUserId={fixtureAdmin.id}
        canDeleteOthers={false}
        uploading={false}
        onUpload={(file) => uploaded.push(file)}
        onDelete={noop}
      />,
    )
    // Act — one valid, one 26 MB (over 25 MB), one disallowed type
    const oversized = new File(['x'], 'huge.png', { type: 'image/png' })
    Object.defineProperty(oversized, 'size', { value: 26 * 1024 * 1024 })
    const files = [
      new File(['ok'], 'good.png', { type: 'image/png' }),
      oversized,
      new File(['zip'], 'archive.zip', { type: 'application/zip' }),
    ]
    const input = screen.getByLabelText<HTMLInputElement>('Browse files')
    await user.upload(input, files)
    // Assert — only the valid file uploads; each skip is announced
    expect(uploaded.map((f) => f.name)).toEqual(['good.png'])
    expect(await screen.findByText(/huge\.png is over 25 MB/)).toBeInTheDocument()
    expect(await screen.findByText(/archive\.zip isn't an image or PDF/)).toBeInTheDocument()
  })

  it("offers delete on others' uploads only when the policy gate allows it (ADR-013)", () => {
    // Arrange — an attachment uploaded by someone else, gate closed
    const theirs = makeAttachment({ id: uid(104), uploadedBy: fixtureTech.id })
    const { unmount } = renderWithProviders(
      <AttachmentsSection
        attachments={[theirs]}
        currentUserId={fixtureAdmin.id}
        canDeleteOthers={false}
        uploading={false}
        onUpload={noop}
        onDelete={noop}
      />,
    )
    const deleteWhileGated = screen.queryByRole('button', { name: 'Delete photo.png' })
    unmount()
    // Act — the permissive default (gate absent) opens the affordance
    renderWithProviders(
      <AttachmentsSection
        attachments={[theirs]}
        currentUserId={fixtureAdmin.id}
        canDeleteOthers
        uploading={false}
        onUpload={noop}
        onDelete={noop}
      />,
    )
    // Assert
    expect(deleteWhileGated).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete photo.png' })).toBeInTheDocument()
  })

  it('hides the dropzone and delete actions when read-only (archived card)', () => {
    // Arrange
    const image = makeAttachment({ id: uid(105) })
    // Act
    renderWithProviders(
      <AttachmentsSection
        attachments={[image]}
        currentUserId={fixtureAdmin.id}
        canDeleteOthers
        uploading={false}
        readOnly
        onUpload={noop}
        onDelete={noop}
      />,
    )
    // Assert — downloads stay available, mutations do not
    expect(screen.getByRole('img', { name: 'photo.png' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Attachment dropzone' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete photo.png' })).not.toBeInTheDocument()
  })

  it('accepts files dropped onto the dropzone', () => {
    // Arrange
    const uploaded: File[] = []
    renderWithProviders(
      <AttachmentsSection
        attachments={[]}
        currentUserId={fixtureAdmin.id}
        canDeleteOthers={false}
        uploading={false}
        onUpload={(file) => uploaded.push(file)}
        onDelete={noop}
      />,
    )
    const dropzone = screen.getByRole('group', { name: 'Attachment dropzone' })
    const file = new File(['pdf-bytes'], 'invoice.pdf', { type: 'application/pdf' })
    // Act
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [file] },
    })
    // Assert
    expect(uploaded.map((f) => f.name)).toEqual(['invoice.pdf'])
  })
})

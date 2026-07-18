import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fixtureAdmin, fixtureTech, makeCard, makeComment, nth, uid } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import classes from './card.module.css'
import { CommentsThread } from './CommentsThread.tsx'

const userNames = new Map([
  [fixtureAdmin.id, fixtureAdmin.displayName],
  [fixtureTech.id, fixtureTech.displayName],
])
const noop = () => undefined

describe('CommentsThread', () => {
  it('renders replies nested under their parent comment', () => {
    // Arrange
    const cardId = makeCard('intake').id
    const parent = makeComment({ id: uid(61), cardId, body: 'Pump is leaking again' })
    const reply = makeComment({
      id: uid(62),
      cardId,
      parentCommentId: parent.id,
      authorId: fixtureTech.id,
      body: 'Ordered a gasket',
      createdAt: '2026-07-02T10:00:00.000Z',
    })
    // Act
    renderWithProviders(
      <CommentsThread
        comments={[parent, reply]}
        currentUserId={fixtureAdmin.id}
        userNames={userNames}
        canDeleteOthers={false}
        onAdd={noop}
        onEdit={noop}
        onDelete={noop}
      />,
    )
    // Assert
    const articles = screen.getAllByRole('article')
    expect(articles).toHaveLength(2)
    expect(within(nth(articles, 0)).getByText('Pump is leaking again')).toBeInTheDocument()
    expect(within(nth(articles, 1)).getByText('Ordered a gasket')).toBeInTheDocument()
  })

  it('shows a placeholder for soft-deleted comments so replies keep context', () => {
    // Arrange
    const cardId = makeCard('intake').id
    const deleted = makeComment({
      id: uid(63),
      cardId,
      deletedAt: '2026-07-03T10:00:00.000Z',
      body: 'gone',
    })
    // Act
    renderWithProviders(
      <CommentsThread
        comments={[deleted]}
        currentUserId={fixtureAdmin.id}
        userNames={userNames}
        canDeleteOthers={false}
        onAdd={noop}
        onEdit={noop}
        onDelete={noop}
      />,
    )
    // Assert
    expect(screen.getByText('(deleted)')).toBeInTheDocument()
    expect(screen.queryByText('gone')).not.toBeInTheDocument()
  })

  it('labels a reply with its parent author and jumps + highlights on click', async () => {
    // Arrange — a reply (by Terry) to Ada's top-level comment.
    const user = userEvent.setup()
    const cardId = makeCard('intake').id
    const parent = makeComment({ id: uid(71), cardId, authorId: fixtureAdmin.id })
    const reply = makeComment({
      id: uid(72),
      cardId,
      parentCommentId: parent.id,
      authorId: fixtureTech.id,
      createdAt: '2026-07-02T10:00:00.000Z',
    })
    renderWithProviders(
      <CommentsThread
        comments={[parent, reply]}
        currentUserId={fixtureAdmin.id}
        userNames={userNames}
        canDeleteOthers={false}
        onAdd={noop}
        onEdit={noop}
        onDelete={noop}
      />,
    )
    // scrollIntoView isn't in happy-dom — a hand-written recorder on the parent
    // element (no mocking libs, per the repo rule) proves the handler ran.
    const parentArticle = nth(screen.getAllByRole('article'), 0)
    const scrolled: unknown[] = []
    parentArticle.scrollIntoView = (arg) => scrolled.push(arg)
    // Act — click the reply's "Replied to Ada Admin" context button.
    await user.click(
      screen.getByRole('button', {
        name: `Go to the comment by ${fixtureAdmin.displayName} this replies to`,
      }),
    )
    // Assert — the label names the parent author, the parent was scrolled into
    // view, and it now carries the highlight class.
    expect(screen.getByText(`Replied to ${fixtureAdmin.displayName}`)).toBeInTheDocument()
    expect(scrolled).toHaveLength(1)
    // Vite types CSS-module members as string | undefined; assert it resolved,
    // then that the parent now carries the flash class.
    const highlight = classes.commentHighlight
    expect(highlight).toBeTruthy()
    expect(parentArticle).toHaveClass(String(highlight))
  })

  it('shows a graceful label when a reply’s parent was deleted', () => {
    // Arrange — the parent is present in the page but soft-deleted.
    const cardId = makeCard('intake').id
    const parent = makeComment({
      id: uid(73),
      cardId,
      authorId: fixtureAdmin.id,
      deletedAt: '2026-07-03T10:00:00.000Z',
    })
    const reply = makeComment({
      id: uid(74),
      cardId,
      parentCommentId: parent.id,
      authorId: fixtureTech.id,
      createdAt: '2026-07-04T10:00:00.000Z',
    })
    // Act
    renderWithProviders(
      <CommentsThread
        comments={[parent, reply]}
        currentUserId={fixtureAdmin.id}
        userNames={userNames}
        canDeleteOthers={false}
        onAdd={noop}
        onEdit={noop}
        onDelete={noop}
      />,
    )
    // Assert — the graceful label, not the deleted author's name.
    expect(screen.getByText('Replied to a deleted comment')).toBeInTheDocument()
    expect(screen.queryByText(`Replied to ${fixtureAdmin.displayName}`)).not.toBeInTheDocument()
  })

  it('offers edit and delete only on own comments when the gate is closed', () => {
    // Arrange
    const cardId = makeCard('intake').id
    const mine = makeComment({ id: uid(64), cardId, authorId: fixtureAdmin.id })
    const theirs = makeComment({ id: uid(65), cardId, authorId: fixtureTech.id })
    // Act
    renderWithProviders(
      <CommentsThread
        comments={[mine, theirs]}
        currentUserId={fixtureAdmin.id}
        userNames={userNames}
        canDeleteOthers={false}
        onAdd={noop}
        onEdit={noop}
        onDelete={noop}
      />,
    )
    // Assert
    const articles = screen.getAllByRole('article')
    expect(
      within(nth(articles, 0)).getByRole('button', { name: 'Edit comment' }),
    ).toBeInTheDocument()
    expect(
      within(nth(articles, 0)).getByRole('button', { name: 'Delete comment' }),
    ).toBeInTheDocument()
    expect(
      within(nth(articles, 1)).queryByRole('button', { name: 'Edit comment' }),
    ).not.toBeInTheDocument()
    expect(
      within(nth(articles, 1)).queryByRole('button', { name: 'Delete comment' }),
    ).not.toBeInTheDocument()
  })

  it("offers delete (never edit) on others' comments when the policy allows it", () => {
    // Arrange — permissive default: the deleteOthersComments gate is absent
    const cardId = makeCard('intake').id
    const theirs = makeComment({ id: uid(67), cardId, authorId: fixtureTech.id })
    // Act
    renderWithProviders(
      <CommentsThread
        comments={[theirs]}
        currentUserId={fixtureAdmin.id}
        userNames={userNames}
        canDeleteOthers
        onAdd={noop}
        onEdit={noop}
        onDelete={noop}
      />,
    )
    // Assert
    const article = screen.getByRole('article')
    expect(within(article).getByRole('button', { name: 'Delete comment' })).toBeInTheDocument()
    expect(within(article).queryByRole('button', { name: 'Edit comment' })).not.toBeInTheDocument()
  })

  it('hides the composer and all comment actions when read-only (archived card)', () => {
    // Arrange
    const cardId = makeCard('done').id
    const mine = makeComment({ id: uid(68), cardId, authorId: fixtureAdmin.id })
    // Act
    renderWithProviders(
      <CommentsThread
        comments={[mine]}
        currentUserId={fixtureAdmin.id}
        userNames={userNames}
        canDeleteOthers
        readOnly
        onAdd={noop}
        onEdit={noop}
        onDelete={noop}
      />,
    )
    // Assert
    expect(screen.queryByRole('textbox', { name: 'Add a comment' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete comment' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reply' })).not.toBeInTheDocument()
  })

  it('posts a top-level comment and a threaded reply with the parent id', async () => {
    // Arrange
    const user = userEvent.setup()
    const cardId = makeCard('intake').id
    const parent = makeComment({ id: uid(66), cardId })
    const added: { body: string; parentCommentId: string | null }[] = []
    renderWithProviders(
      <CommentsThread
        comments={[parent]}
        currentUserId={fixtureAdmin.id}
        userNames={userNames}
        canDeleteOthers={false}
        onAdd={(body, parentCommentId) => added.push({ body, parentCommentId })}
        onEdit={noop}
        onDelete={noop}
      />,
    )
    // Act
    await user.type(screen.getByRole('textbox', { name: 'Add a comment' }), 'Top level note')
    await user.click(screen.getByRole('button', { name: 'Comment' }))
    await user.click(screen.getByRole('button', { name: 'Reply' }))
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'A reply')
    // The reply composer's submit has its own accessible name — no ambiguity.
    await user.click(screen.getByRole('button', { name: 'Post reply' }))
    // Assert
    expect(added).toEqual([
      { body: 'Top level note', parentCommentId: null },
      { body: 'A reply', parentCommentId: parent.id },
    ])
  })

  it('spins the composer submit while an add is pending and keeps the delete confirm open', async () => {
    // Arrange — a pending add + pending delete; the composer submit and the
    // confirm dialog's button should both show their loading affordance.
    const user = userEvent.setup()
    const cardId = makeCard('intake').id
    const mine = makeComment({ id: uid(70), cardId, authorId: fixtureAdmin.id })
    renderWithProviders(
      <CommentsThread
        comments={[mine]}
        currentUserId={fixtureAdmin.id}
        userNames={userNames}
        canDeleteOthers={false}
        addPending
        deletePending
        onAdd={noop}
        onEdit={noop}
        onDelete={noop}
      />,
    )
    // Act — submit a comment (marks this composer as the one submitting), then
    // open the delete confirm without confirming it away.
    await user.type(screen.getByRole('textbox', { name: 'Add a comment' }), 'Please wait')
    await user.click(screen.getByRole('button', { name: 'Comment' }))
    await user.click(screen.getByRole('button', { name: 'Delete comment' }))
    // Assert — the composer submit spins and the confirm dialog stays open with
    // a spinning confirm (a slow delete can't be re-clicked or lost).
    expect(screen.getByRole('button', { name: 'Comment' })).toHaveAttribute('data-loading', 'true')
    expect(screen.getByRole('button', { name: 'Delete it' })).toHaveAttribute(
      'data-loading',
      'true',
    )
  })
})

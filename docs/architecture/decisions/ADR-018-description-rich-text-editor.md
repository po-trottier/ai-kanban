# ADR-018: Rich-text description editor storing markdown

## Status

Accepted.

## Context

Card descriptions are authored by non-technical facilities staff. They are
stored as **markdown** (`cards.description`, ≤ 20,000 chars — see
[data-model.md](../data-model.md)) so the same text renders cleanly in the web
app, in card-created history snapshots, and in Slack summaries, and stays
diff-friendly and portable (no HTML lock-in).

The first cut was a plain textarea with a Write/Preview toggle. That works but
a requester has to know markdown syntax to format anything. The product ask was
a proper editor.

## Decision

Use a **WYSIWYG editor that still reads and writes markdown**: Mantine's
`RichTextEditor` over **Tiptap v3**, with the `tiptap-markdown` extension doing
the markdown ⇄ ProseMirror conversion.

- The editor is fed the stored markdown as its content and serializes back to
  markdown on every edit (`editor.storage.markdown.getMarkdown()`), so the
  persisted format is unchanged — only the editing surface is richer.
- Toolbar scope is deliberately small (bold, italic, strikethrough, inline
  code, H1–H3, bullet/ordered lists, blockquote, link) — the formatting a work
  order actually needs, nothing that would produce markdown the other readers
  can't render.
- The editor is a controlled component: an external value change (a server
  refetch of an untouched field) re-loads the content, but the component tracks
  the markdown it last emitted so a user's own keystrokes never re-parse and
  jump the cursor.

Rejected alternatives: keep the textarea + Preview (functional but not the
asked-for editor); store HTML instead of markdown (breaks history snapshots and
Slack summaries, and locks the format in).

## Consequences

- New web dependencies: `@mantine/tiptap`, `@tiptap/react`, `@tiptap/pm`,
  `@tiptap/starter-kit`, `@tiptap/extension-link` (bundled by StarterKit v3),
  and `tiptap-markdown`. Client-only; no backend change.
- The stored contract (markdown) is untouched, so nothing downstream changes.
- Markdown is normalized on round-trip (the editor's serializer is canonical),
  so re-saving an unchanged description may tidy its whitespace — acceptable for
  a human-authored field.
- `tiptap-markdown` doesn't augment the public Tiptap `Storage` type, so the
  markdown accessor is read through one narrow, explicit cast in
  `DescriptionEditor`.

import { Input, Stack } from '@mantine/core'
import { RichTextEditor } from '@mantine/tiptap'
import { useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useRef } from 'react'
import { Markdown } from 'tiptap-markdown'
import { FieldLabel } from '../shell/FieldLabel.tsx'
import { strings } from '../strings.ts'

/** `tiptap-markdown` adds this to the editor storage but doesn't augment the
 * public Storage type, so read it through a narrow, explicit shape. */
function getMarkdown(editor: Editor): string {
  return (
    editor.storage as unknown as { markdown: { getMarkdown: () => string } }
  ).markdown.getMarkdown()
}

export interface DescriptionEditorProps {
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}

/**
 * A WYSIWYG description editor (Mantine RichTextEditor over Tiptap) that still
 * READS and WRITES markdown — the stored format (data-model.md, ADR-018). The
 * `tiptap-markdown` extension parses the markdown value on load and serializes
 * back to markdown on every edit, so the rest of the app (history snapshots,
 * Slack summaries) keeps seeing markdown, not HTML.
 */
export function DescriptionEditor({ value, disabled = false, onChange }: DescriptionEditorProps) {
  // The markdown we last handed up, so an external value change re-loads the
  // editor but our own keystrokes never re-parse (which would jump the cursor).
  const lastEmitted = useRef(value)
  const editor = useEditor({
    // Links open in a new tab with a safe rel by default. StarterKit bundles the
    // Link extension (ADR-018); these HTMLAttributes seed every link's target/rel
    // (covering paste + autolink), and the toolbar's `initialExternal` toggle sets
    // target="_blank" on links inserted from the control.
    extensions: [
      StarterKit.configure({
        link: { HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' } },
      }),
      Markdown,
    ],
    content: value,
    editable: !disabled,
    // Client-only SPA, but defer first render so React 19 strict mode doesn't
    // double-create the ProseMirror view.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': strings.detail.descriptionLabel,
      },
    },
    onUpdate: ({ editor: current }) => {
      const markdown = getMarkdown(current)
      lastEmitted.current = markdown
      onChange(markdown)
    },
  })

  useEffect(() => {
    if (editor === null || value === lastEmitted.current) return
    lastEmitted.current = value
    editor.commands.setContent(value, { emitUpdate: false })
  }, [editor, value])

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [editor, disabled])

  return (
    <Stack gap="xs">
      <Input.Label>
        <FieldLabel label={strings.detail.descriptionLabel} help={strings.detail.descriptionHelp} />
      </Input.Label>
      <RichTextEditor editor={editor}>
        <RichTextEditor.Toolbar sticky>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.Bold />
            <RichTextEditor.Italic />
            <RichTextEditor.Strikethrough />
            <RichTextEditor.Code />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.H1 />
            <RichTextEditor.H2 />
            <RichTextEditor.H3 />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.BulletList />
            <RichTextEditor.OrderedList />
            <RichTextEditor.Blockquote />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            {/* Toggle defaults ON so a link inserted from the toolbar opens in a
                new tab; the Link extension's HTMLAttributes add the safe rel. */}
            <RichTextEditor.Link initialExternal />
            <RichTextEditor.Unlink />
          </RichTextEditor.ControlsGroup>
        </RichTextEditor.Toolbar>
        <RichTextEditor.Content />
      </RichTextEditor>
    </Stack>
  )
}

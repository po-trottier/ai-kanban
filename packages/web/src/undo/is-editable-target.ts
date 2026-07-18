/**
 * True when a keyboard event originates inside an editable surface — a text
 * input, a textarea, or anything under a `contenteditable` host (the rich-text
 * description and comment editors mount as contenteditable). The global
 * undo/redo handler bails in that case so native in-field text undo/redo
 * (Ctrl+Z / Ctrl+Y in a field, the TipTap description, comments) is never
 * hijacked (ITEM 86).
 *
 * We read `event.target` (the focused node), not `document.activeElement`, so a
 * synthetic/dispatched event in tests is judged by the same rule as a real one.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  // `isContentEditable` is true for the host AND every descendant of a
  // contenteditable region, so a caret deep inside the rich-text editor counts.
  return target.isContentEditable
}

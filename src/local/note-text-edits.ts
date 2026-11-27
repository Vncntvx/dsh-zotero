/** Editable text in ordinary note blocks. Zotero's authored markup stays in the source string. */
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5'
import {
  ZOTERO_READER_NOTE_EDIT_RUNS,
  ZOTERO_READER_NOTE_FORMATS,
  ZOTERO_READER_NOTE_HTML_CHARS,
  ZOTERO_READER_NOTE_TEXT_CHARS,
} from '../constants.js'
import { invalid } from '../errors.js'
import { isNonNegativeSafeInteger } from '../json.js'
import type { ZoteroNoteTextEdit } from '../types.js'
import { escapeHtml } from './note-format.js'

const HTML = 'http://www.w3.org/1999/xhtml'
const BLOCK = /^(?:p|h[1-6]|li|blockquote|td|th|pre)$/
const CONTENT =
  /^(?:div|p|h[1-6]|li|ol|ul|blockquote|table|thead|tbody|tfoot|tr|td|th|pre|b|i|strong|em|mark|s|u|code|span|sub|sup)$/

const splitsSurrogate = (text: string, offset: number) =>
  /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(text.slice(Math.max(0, offset - 1), offset + 1))

function formattedText(
  text: string,
  formatting: readonly {
    readonly format: (typeof ZOTERO_READER_NOTE_FORMATS)[number]
    readonly range?: { readonly start: number; readonly end: number }
  }[],
): string {
  const boundaries = new Set([0, text.length])
  for (const { format, range } of formatting) {
    if (!ZOTERO_READER_NOTE_FORMATS.includes(format))
      invalid('A note edit requests unsupported formatting.')
    if (range === undefined) continue
    const { start, end } = range
    if (
      !isNonNegativeSafeInteger(start) ||
      !isNonNegativeSafeInteger(end) ||
      start >= end ||
      end > text.length ||
      splitsSurrogate(text, start) ||
      splitsSurrogate(text, end)
    )
      invalid('The note formatting range must select whole characters within the text run.')
    boundaries.add(start)
    boundaries.add(end)
  }
  const points = [...boundaries].sort((left, right) => left - right)
  let html = ''
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index]!
    const end = points[index + 1]!
    const active = formatting.filter(
      ({ range }) => range === undefined || (range.start <= start && range.end >= end),
    )
    let segment = escapeHtml(text.slice(start, end))
    for (const { format } of active) segment = `<${format}>${segment}</${format}>`
    html += segment
  }
  return html
}

export function noteTextRuns(html: string) {
  const runs: (Pick<ZoteroNoteTextEdit, 'offset' | 'text'> & { end: number })[] = []
  if (html.length > ZOTERO_READER_NOTE_HTML_CHARS) return runs
  const walk = (nodes: DefaultTreeAdapterTypes.ChildNode[], inBlock: boolean, depth: number) => {
    if (depth > 32) return
    for (const node of nodes) {
      if (runs.length >= ZOTERO_READER_NOTE_EDIT_RUNS) return
      if ('tagName' in node) {
        const metadataContainer =
          depth === 0 &&
          node.tagName === 'div' &&
          node.attrs.some(
            ({ name, value }) => name === 'data-schema-version' && /^\d+$/.test(value),
          ) &&
          node.attrs.every(
            ({ name }) => name === 'data-schema-version' || name === 'data-citation-items',
          )
        if (
          node.namespaceURI === HTML &&
          CONTENT.test(node.tagName) &&
          (metadataContainer ||
            !node.attrs.some(
              ({ name, value }) =>
                name.startsWith('data-') ||
                (name === 'class' && /\b(?:citation|highlight)\b/i.test(value)),
            ))
        )
          walk(node.childNodes, inBlock || BLOCK.test(node.tagName), depth + 1)
        continue
      }
      if (node.nodeName !== '#text' || !inBlock) continue
      const location = node.sourceCodeLocation
      if (
        !location ||
        !node.value.trim() ||
        node.value.length > ZOTERO_READER_NOTE_TEXT_CHARS ||
        html.slice(location.startOffset, location.endOffset).includes('<')
      )
        continue
      runs.push({ offset: location.startOffset, end: location.endOffset, text: node.value })
    }
  }
  walk(parseFragment(html, { sourceCodeLocationInfo: true }).childNodes, false, 0)
  return runs
}

export function applyNoteTextEdits(html: string, edits: readonly ZoteroNoteTextEdit[]): string {
  if (edits.length === 0 || edits.length > ZOTERO_READER_NOTE_EDIT_RUNS)
    invalid('Select at least one editable note text run.')
  const runs = new Map(noteTextRuns(html).map((run) => [run.offset, run]))
  let next = ''
  let cursor = 0
  for (const edit of [...edits].sort((a, b) => a.offset - b.offset)) {
    const run = runs.get(edit.offset)
    if (!run || cursor > run.offset || edit.text.length > ZOTERO_READER_NOTE_TEXT_CHARS)
      invalid('A note edit targets an invalid or duplicate text run.')
    const { format, formatRange, formatting } = edit
    const formats = formatting ?? (format === undefined ? [] : [{ format, range: formatRange }])
    if (
      formatting !== undefined &&
      (format !== undefined || formatRange !== undefined || formatting.length === 0)
    )
      invalid('A note edit must use one supported formatting representation.')
    if (formatRange !== undefined && format === undefined)
      invalid('A note formatting range requires a format.')
    next += html.slice(cursor, run.offset)
    if (formats.length > 0) next += formattedText(edit.text, formats)
    else next += edit.text === run.text ? html.slice(run.offset, run.end) : escapeHtml(edit.text)
    cursor = run.end
  }
  next += html.slice(cursor)
  if (next.length > ZOTERO_READER_NOTE_HTML_CHARS)
    invalid('The edited note exceeds the Reader limit.')
  return next
}

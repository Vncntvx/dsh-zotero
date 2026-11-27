import {
  ZOTERO_READER_NOTE_EDIT_RUNS,
  ZOTERO_READER_NOTE_FORMATS,
  ZOTERO_READER_NOTE_HTML_CHARS,
  ZOTERO_READER_NOTE_TEXT_CHARS,
} from '../../constants.ts'
import type { ZoteroNoteTextEdit, ZoteroNoteTextFormatting } from '../../types.ts'
import { refFieldsOf } from '../../ref-grammar.ts'

const MAX_MEMORY_DRAFTS = 16
// This map is local to the browser tab. A cleared draft shadows inaccessible storage.
const memoryDrafts = new Map<string, string | null>()
const splitsSurrogate = (text: string, offset: number) =>
  /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(text.slice(Math.max(0, offset - 1), offset + 1))

export interface NoteDraft {
  readonly version?: number
  readonly submitted?: boolean
  readonly fields: Readonly<Record<string, string>>
}

export type NoteDraftRetention = 'stored' | 'memory' | 'unavailable'

export function noteDraftFormat(
  value: string | undefined,
  text: string,
): Pick<ZoteroNoteTextEdit, 'format' | 'formatRange'> | undefined {
  if (!value) return undefined
  const [name, startText, endText, extra] = value.split(':')
  const format = ZOTERO_READER_NOTE_FORMATS.find((option) => option === name)
  if (!format) return undefined
  if (startText === undefined) return { format }
  const start = Number(startText)
  const end = Number(endText)
  if (
    extra !== undefined ||
    !startText ||
    !endText ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= end ||
    end > text.length ||
    splitsSurrogate(text, start) ||
    splitsSurrogate(text, end)
  )
    return undefined
  return { format, formatRange: { start, end } }
}

export function noteDraftFormats(
  value: string | undefined,
  text: string,
): readonly ZoteroNoteTextFormatting[] {
  if (!value) return []
  if (!value.startsWith('[')) {
    const legacy = noteDraftFormat(value, text)
    return legacy?.format === undefined
      ? []
      : [{ format: legacy.format, ...(legacy.formatRange && { range: legacy.formatRange }) }]
  }
  try {
    const parsed: unknown = JSON.parse(value)
    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      parsed.length > ZOTERO_READER_NOTE_EDIT_RUNS
    )
      return []
    return parsed.flatMap((entry): ZoteroNoteTextFormatting[] => {
      if (typeof entry !== 'object' || entry === null) return []
      const { format, range } = entry as { format?: unknown; range?: unknown }
      if (!ZOTERO_READER_NOTE_FORMATS.some((candidate) => candidate === format)) return []
      if (range === undefined) return [{ format } as ZoteroNoteTextFormatting]
      if (typeof range !== 'object' || range === null) return []
      const { start, end } = range as { start?: unknown; end?: unknown }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        (start as number) < 0 ||
        (start as number) >= (end as number) ||
        (end as number) > text.length ||
        splitsSurrogate(text, start as number) ||
        splitsSurrogate(text, end as number)
      )
        return []
      return [
        {
          format,
          range: { start: start as number, end: end as number },
        } as ZoteroNoteTextFormatting,
      ]
    })
  } catch {
    return []
  }
}

export function noteDraftKey(
  sessionId: string,
  ref: string,
  operation: 'create' | 'edit' | 'delete',
  origin?: string,
) {
  if (operation === 'delete' || !refFieldsOf(ref)?.serverId) return undefined
  return `dsh-zotero:reader:note-draft:v1:${JSON.stringify(origin === undefined ? [sessionId, ref, operation] : [sessionId, ref, operation, origin])}`
}

export function readNoteDraft(key: string | undefined) {
  if (!key) return undefined
  try {
    const memory = memoryDrafts.has(key)
    const raw = memory ? memoryDrafts.get(key) : sessionStorage.getItem(key)
    if (!raw || raw.length > ZOTERO_READER_NOTE_HTML_CHARS) return undefined
    const draft = JSON.parse(raw) as Partial<NoteDraft> | null
    if (!draft?.fields || typeof draft.fields !== 'object' || Array.isArray(draft.fields))
      return undefined
    const entries = Object.entries(draft.fields)
    if (
      entries.every(
        ([name, text]) =>
          /^(?:markdown|(?:format-)?\d{1,6})$/.test(name) &&
          typeof text === 'string' &&
          text.length <= ZOTERO_READER_NOTE_TEXT_CHARS,
      )
    ) {
      return {
        retention: memory ? ('memory' as const) : ('stored' as const),
        draft: {
          version: draft.version,
          submitted: draft.submitted === true,
          fields: Object.fromEntries(entries),
        } satisfies NoteDraft,
      }
    }
  } catch {
    // The browser may deny session storage or contain malformed state.
  }
  return undefined
}

export function writeNoteDraft(key: string | undefined, draft?: NoteDraft): NoteDraftRetention {
  if (!key) return 'unavailable'
  // Reserve room for the submitted marker before relying on the draft for reconciliation.
  const raw = draft ? JSON.stringify({ ...draft, submitted: draft.submitted === true }) : null
  const oversized = (raw?.length ?? 0) > ZOTERO_READER_NOTE_HTML_CHARS
  const value = oversized ? null : raw
  try {
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, value)
    memoryDrafts.delete(key)
    return oversized ? 'unavailable' : 'stored'
  } catch {
    if (!memoryDrafts.has(key) && memoryDrafts.size >= MAX_MEMORY_DRAFTS) return 'unavailable'
    memoryDrafts.set(key, value)
    return oversized ? 'unavailable' : 'memory'
  }
}

import type {
  ChatSnapshot,
  SteeringMessageNode,
  UserMessageNode,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import { asRecord, isNonNegativeSafeInteger, numberField, stringField } from '../../json.ts'
import { ZOTERO_READER_TRANSLATION_SOURCE_CHARS } from '../../constants.ts'
import type { PdfArtifactRegion, PdfPageRegion, PdfRect, TextRange } from '../../reader/evidence.ts'
import { refFieldsOf } from '../../ref-grammar.ts'
import { MAX_PARSED_CITATION_PREFIX } from '../parsed-tab.ts'
import { MAX_EXCERPT_RECTS } from './pdf-excerpt.ts'

export interface HistoricalPdfCitation {
  readonly attachmentRef: string
  readonly fingerprint: string
  readonly title: string
  readonly position?: PdfPageRegion
  readonly artifactRegion?: PdfArtifactRegion
}

export type HistoricalTextCitation = {
  readonly attachmentRef: string
  readonly fingerprint?: string
  readonly title: string
  readonly documentType: 'html' | 'markdown' | 'text'
  readonly textRange: TextRange
}

export type HistoricalCitation =
  | HistoricalPdfCitation
  | HistoricalTextCitation
  | {
      readonly artifactId: string
      readonly attachmentRef?: string
      readonly fingerprint: string
      readonly title: string
      readonly textRange: TextRange
      readonly textPrefix?: string
    }
  | { readonly noteRef: string; readonly title: string; readonly noteVersion?: number }

const MAX_CITATIONS = 32
const cache = new WeakMap<UserMessageNode | SteeringMessageNode, readonly HistoricalCitation[]>()

function rectOf(value: unknown): PdfRect | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  const x = numberField(record, 'x')
  const y = numberField(record, 'y')
  const width = numberField(record, 'width')
  const height = numberField(record, 'height')
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(x + width) ||
    !Number.isFinite(y + height)
  )
    return undefined
  return { x, y, width, height }
}

function citationOf(value: unknown): HistoricalCitation | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  const noteRef = stringField(record, 'noteRef')
  const attachmentRef = stringField(record, 'attachmentRef')
  const fingerprint = stringField(record, 'fingerprint')
  const title = stringField(record, 'title')
  if (noteRef && record.sourceType === 'note' && refFieldsOf(noteRef)?.kind === 'item')
    return {
      noteRef,
      title: title?.slice(0, 500) || noteRef,
      ...(isNonNegativeSafeInteger(record.noteVersion) && { noteVersion: record.noteVersion }),
    }
  const documentType = record.documentType
  if (documentType === 'parsed') {
    const artifactId = stringField(record, 'artifactId')
    const textPrefix = stringField(record, 'textPrefix')
    const range = asRecord(record.textRange)
    const start = range?.start
    const end = range?.end
    if (
      !artifactId ||
      !fingerprint ||
      !/^[a-f0-9]{64}$/u.test(artifactId) ||
      !/^[a-f0-9]{64}$/u.test(fingerprint) ||
      (record.attachmentRef !== undefined &&
        (!attachmentRef || refFieldsOf(attachmentRef)?.kind !== 'attachment')) ||
      !isNonNegativeSafeInteger(start) ||
      !isNonNegativeSafeInteger(end) ||
      start >= end ||
      end - start > ZOTERO_READER_TRANSLATION_SOURCE_CHARS ||
      (record.textPrefix !== undefined &&
        (!textPrefix || textPrefix.length > Math.min(MAX_PARSED_CITATION_PREFIX, end - start)))
    )
      return undefined
    return {
      artifactId,
      attachmentRef,
      fingerprint,
      title: title?.slice(0, 500) || artifactId,
      textRange: { start, end },
      ...(textPrefix !== undefined && { textPrefix }),
    }
  }
  if (documentType === 'html' || documentType === 'markdown' || documentType === 'text') {
    const range = asRecord(record.textRange)
    const start = range?.start
    const end = range?.end
    if (
      !attachmentRef ||
      refFieldsOf(attachmentRef)?.kind !== 'attachment' ||
      !isNonNegativeSafeInteger(start) ||
      !isNonNegativeSafeInteger(end) ||
      start >= end ||
      end - start > 16_000
    )
      return undefined
    return {
      attachmentRef,
      title: title?.slice(0, 500) || attachmentRef,
      documentType,
      textRange: { start, end },
      ...(fingerprint && /^sha256:[0-9a-f]{64}$/u.test(fingerprint) && { fingerprint }),
    }
  }
  if (
    !attachmentRef ||
    !fingerprint ||
    !/^[a-z0-9:_-]{1,136}$/i.test(fingerprint) ||
    !title ||
    !Array.isArray(record.pages)
  )
    return undefined
  const identity = refFieldsOf(attachmentRef)
  if (
    identity?.kind !== 'attachment' ||
    record.instanceId !== identity.serverId ||
    record.libraryRef !== `zotero://${identity.libraryType}/${identity.libraryId}/`
  )
    return undefined
  const page = asRecord(record.pages[0])
  const artifactBox = page?.artifactBox
  const box =
    Array.isArray(artifactBox) &&
    artifactBox.length === 4 &&
    artifactBox.every(
      (coordinate) => isNonNegativeSafeInteger(coordinate) && coordinate <= 1_000,
    ) &&
    artifactBox[0] < artifactBox[2] &&
    artifactBox[1] < artifactBox[3]
      ? ([artifactBox[0], artifactBox[1], artifactBox[2], artifactBox[3]] as const)
      : undefined
  const structured = record.sourceType === 'mineru' && /^sha256:[0-9a-f]{64}$/u.test(fingerprint)
  const rects =
    Array.isArray(page?.rects) && page.rects.length <= MAX_EXCERPT_RECTS
      ? page.rects.map(rectOf).filter((rect) => rect !== undefined)
      : []
  return {
    attachmentRef,
    fingerprint,
    title: title.slice(0, 500),
    ...(isNonNegativeSafeInteger(page?.pageIndex) && {
      position: { pageIndex: page.pageIndex, rects },
      ...(structured && { artifactRegion: { pageIndex: page.pageIndex, ...(box && { box }) } }),
    }),
  }
}

function messageCitations(message: UserMessageNode | SteeringMessageNode) {
  const existing = cache.get(message)
  if (existing) return existing
  const citations: HistoricalCitation[] = []
  for (const block of message.content) {
    if (block.type !== 'text') continue
    // Composer emits quote nodes as Markdown and separates them with an unquoted blank line.
    for (const [, json] of block.text.matchAll(
      /^> (\[?\{"(?:attachmentRef|noteRef|sourceType)":[^\r\n]{1,16384}\}\]?)\r?$(?!\r?\n>)/gm,
    )) {
      let parsed: unknown
      try {
        parsed = JSON.parse(json!)
      } catch {
        continue
      }
      for (const record of Array.isArray(parsed) ? parsed : [parsed]) {
        const citation = citationOf(record)
        if (citation) citations.push(citation)
        if (citations.length === MAX_CITATIONS) break
      }
      if (citations.length === MAX_CITATIONS) break
    }
    if (citations.length === MAX_CITATIONS) break
  }
  cache.set(message, citations)
  return citations
}

export function turnCitations(snapshot: ChatSnapshot, turn: number): HistoricalCitation[] {
  const found: HistoricalCitation[] = []
  for (const key of snapshot.locations.getTurn(turn)) {
    const node = snapshot.nodes.get(key)
    if (node?.visibility !== 'visible' || (node.kind !== 'user' && node.kind !== 'steering'))
      continue
    for (const citation of messageCitations(node.data as UserMessageNode | SteeringMessageNode)) {
      found.push(citation)
      if (found.length === MAX_CITATIONS) return found
    }
  }
  return found
}

import type { TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ZoteroParsedDocumentRowView, ZoteroParsedDocumentState } from '../../../contract.ts'
import { joinNonEmpty } from '../../../sources/presenters.js'
import {
  formatCount,
  shortArtifactId,
  sourceDescriptorOf,
  totalBytesOf,
} from '../parsed-manager-model.ts'
import { fileSizeText, relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'

export type StateFilter = 'all' | ZoteroParsedDocumentState

export const FILTERS: readonly StateFilter[] = ['all', 'indexed', 'orphan', 'broken']

export const FILTER_LABELS = {
  all: 'parsedManagerFilterAll',
  indexed: 'parsedManagerFilterIndexed',
  orphan: 'parsedManagerFilterOrphan',
  broken: 'parsedManagerFilterBroken',
} as const

export const STATE_LABELS = {
  indexed: 'parsedManagerStateIndexed',
  orphan: 'parsedManagerStateOrphan',
  broken: 'parsedManagerStateBroken',
} as const

export const STATE_TONES: Record<ZoteroParsedDocumentState, TagTone> = {
  indexed: 'success',
  orphan: 'warning',
  broken: 'danger',
}

export const AGO_LABELS = {
  minutes: 'parsedManagerAgoMinutes',
  hours: 'parsedManagerAgoHours',
  days: 'parsedManagerAgoDays',
  months: 'parsedManagerAgoMonths',
  years: 'parsedManagerAgoYears',
} as const

export const BROKEN_LABELS: Record<
  NonNullable<ZoteroParsedDocumentRowView['broken']>['code'],
  'parsedManagerBrokenMissingMeta' | 'parsedManagerBrokenUnreadableMeta'
> = {
  'missing-meta': 'parsedManagerBrokenMissingMeta',
  'unreadable-meta': 'parsedManagerBrokenUnreadableMeta',
}

export function titleOf(row: ZoteroParsedDocumentRowView): string {
  return row.title !== undefined && row.title.trim() !== ''
    ? row.title
    : shortArtifactId(row.artifactId)
}

export function agoOf(at: number, now: number, t: TranslateNS<'zotero'>): string {
  const age = relativeTime(at, now)
  return age.unit === 'now' ? t('parsedManagerAgoNow') : t(AGO_LABELS[age.unit], { count: age.n })
}

export function metaOf(
  row: ZoteroParsedDocumentRowView,
  now: number,
  t: TranslateNS<'zotero'>,
): string {
  if (row.state === 'broken') return ''
  const source = sourceDescriptorOf(row)
  return joinNonEmpty(
    source === ''
      ? undefined
      : row.sourceKind === 'attachment'
        ? t('parsedManagerSourceAttachment', { key: source })
        : source,
    agoOf(row.committedAt, now, t),
    fileSizeText(totalBytesOf(row)),
    t('parsedManagerChars', { count: formatCount(row.characterCount) }),
    row.pageCount === undefined ? undefined : t('libraryParsedPages', { count: row.pageCount }),
    row.images.length === 0 ? undefined : t('parsedManagerImages', { count: row.images.length }),
    row.mode === 'pro' ? t('parsedManagerModePro') : undefined,
  )
}

/**
 * @module dsh-zotero/client/sources/export-decoder
 */

import { isRecord, numberField, stringArrayOf, stringField } from '../json.js'
import { detailOmittedOf } from './decoders.js'
import type { ExportDocumentItem } from './model.js'

/** The export projection view; a record without refs itemizes none. */
export interface ExportMetaView {
  readonly format: string | null
  readonly style: string | null
  readonly locale: string | null
  readonly refs: readonly string[]
  readonly refsOmitted: number
  /** The bounded per-document items; empty when the projection carried none. */
  readonly items: readonly ExportDocumentItem[]
  /** True when the meta budget dropped the detail rows behind these facts. */
  readonly detailOmitted: boolean
}

/** The bounded per-document items of an export projection; malformed rows are dropped. */
function exportItemsOf(value: unknown): ExportDocumentItem[] {
  if (!Array.isArray(value)) return []
  const items: ExportDocumentItem[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const ref = stringField(entry, 'ref')
    if (ref === undefined) continue
    const exportKey = stringField(entry, 'exportKey')
    const citationKey = stringField(entry, 'citationKey')
    const citationKeySourceValue = stringField(entry, 'citationKeySource')
    const citationKeySource =
      citationKeySourceValue === 'native' || citationKeySourceValue === 'extra'
        ? citationKeySourceValue
        : undefined
    const conflictValue = isRecord(entry['citationKeyConflict'])
      ? entry['citationKeyConflict']
      : null
    const citationKeyConflict =
      conflictValue === null
        ? undefined
        : {
            native: stringField(conflictValue, 'native'),
            extra: stringField(conflictValue, 'extra'),
          }
    const title = stringField(entry, 'title')
    const entryIndex = numberField(entry, 'entryIndex')
    const start = numberField(entry, 'start')
    const end = numberField(entry, 'end')
    items.push({
      ref,
      ...(exportKey === undefined ? {} : { exportKey }),
      ...(citationKey === undefined ? {} : { citationKey }),
      ...(citationKeySource === undefined ? {} : { citationKeySource }),
      ...(citationKeyConflict?.native === undefined || citationKeyConflict.extra === undefined
        ? {}
        : {
            citationKeyConflict: {
              native: citationKeyConflict.native,
              extra: citationKeyConflict.extra,
            },
          }),
      ...(title === undefined ? {} : { title }),
      ...(entryIndex === undefined ? {} : { entryIndex }),
      ...(start === undefined ? {} : { start }),
      ...(end === undefined ? {} : { end }),
    })
  }
  return items
}

export function exportMetaOf(meta: Record<string, unknown>): ExportMetaView {
  return {
    format: stringField(meta, 'format') ?? null,
    style: stringField(meta, 'style') ?? null,
    locale: stringField(meta, 'locale') ?? null,
    refs: stringArrayOf(meta['refs']),
    refsOmitted: numberField(meta, 'refsOmitted') ?? 0,
    items: exportItemsOf(meta['items']),
    detailOmitted: detailOmittedOf(meta),
  }
}

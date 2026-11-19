/**
 * @module dsh-zotero/sources/export-decoder
 */
import { isRecord, numberField, stringArrayOf, stringField } from '../json.js';
import { detailOmittedOf } from './decoders.js';
/** The bounded per-document items of an export projection; malformed rows are dropped. */
function exportItemsOf(value) {
    if (!Array.isArray(value))
        return [];
    const items = [];
    for (const entry of value) {
        if (!isRecord(entry))
            continue;
        const ref = stringField(entry, 'ref');
        if (ref === undefined)
            continue;
        const exportKey = stringField(entry, 'exportKey');
        const citationKey = stringField(entry, 'citationKey');
        const citationKeySourceValue = stringField(entry, 'citationKeySource');
        const citationKeySource = citationKeySourceValue === 'native' || citationKeySourceValue === 'extra'
            ? citationKeySourceValue
            : undefined;
        const conflictValue = isRecord(entry['citationKeyConflict'])
            ? entry['citationKeyConflict']
            : null;
        const citationKeyConflict = conflictValue === null
            ? undefined
            : {
                native: stringField(conflictValue, 'native'),
                extra: stringField(conflictValue, 'extra'),
            };
        const title = stringField(entry, 'title');
        const entryIndex = numberField(entry, 'entryIndex');
        const start = numberField(entry, 'start');
        const end = numberField(entry, 'end');
        if (entry['start'] !== undefined || entry['end'] !== undefined) {
            if (start === undefined ||
                end === undefined ||
                !Number.isSafeInteger(start) ||
                !Number.isSafeInteger(end) ||
                start < 0 ||
                end <= start)
                continue;
        }
        const item = {
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
        };
        items.push(start === undefined || end === undefined ? item : { ...item, start, end });
    }
    return items;
}
export function exportMetaOf(meta) {
    return {
        format: stringField(meta, 'format') ?? null,
        style: stringField(meta, 'style') ?? null,
        locale: stringField(meta, 'locale') ?? null,
        refs: stringArrayOf(meta['refs']),
        refsOmitted: numberField(meta, 'refsOmitted') ?? 0,
        items: exportItemsOf(meta['items']),
        detailOmitted: detailOmittedOf(meta),
    };
}
//# sourceMappingURL=export-decoder.js.map
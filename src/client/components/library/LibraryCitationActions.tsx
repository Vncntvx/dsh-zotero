/**
 * The inspector action row's citation controls: a single consolidated menu
 * offering all export formats (CSL citation, bibliography, BibTeX, BibLaTeX,
 * RIS, CSL-JSON) plus a client-only item-info block generated from the
 * inspected record.
 *
 * Every wire copy asks for `refs: [detail.ref]` with no style/locale, so the
 * host's configured rendering defaults decide the text, exactly like the
 * zotero_export tool. The shared {@link useCopyFeedback} lane owns the
 * clipboard write and the stale-answer guards; the anchor button reflects the
 * active copy state and done label, failures stay inline beside the control,
 * and no copy is ever retried.
 * @module dsh-zotero/client/components/library/LibraryCitationActions
 */

import { useEffect, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Button,
  IconChevronDownOutlineRegular,
  IconCopyOutlineRegular,
  Menu,
  MenuItemButton,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ZoteroItemDetailView,
  ZoteroLibraryExportFormatView,
  ZoteroLibraryExportResultView,
} from '../../../contract.ts'
import { formatCreatorsList } from '../../../creators.ts'
import type { ZoteroLocaleKey } from '../../locales.ts'
import { messageOf } from '../../error-text.ts'
import { joinNonEmpty } from '../../presenters.ts'
import { useCopyFeedback } from '../useCopyFeedback.ts'
import type { LibraryExportItem } from './library-feed-types.ts'
import css from './library.module.css'

/** The client-only action; every other action id is a host export format. */
type CopyAction = ZoteroLibraryExportFormatView | 'itemInfo'

/** The done label of every action: each control reports the format it copied. */
const DONE_KEY: Record<CopyAction, ZoteroLocaleKey> = {
  citation: 'libraryCopyCitationDone',
  bibtex: 'libraryCopyBibtexDone',
  bibliography: 'libraryCopyBibliographyDone',
  biblatex: 'libraryCopyBiblatexDone',
  ris: 'libraryCopyRisDone',
  csljson: 'libraryCopyCsljsonDone',
  itemInfo: 'libraryCopyItemInfoDone',
}

/** The menu's wire and local formats, in frequency order. */
const ALL_FORMATS: readonly {
  readonly format: CopyAction
  readonly label: ZoteroLocaleKey
  readonly separatorBefore?: boolean
}[] = [
  { format: 'bibtex', label: 'libraryCopyBibtex' },
  { format: 'biblatex', label: 'libraryCopyBiblatex' },
  { format: 'ris', label: 'libraryCopyRis' },
  { format: 'csljson', label: 'libraryCopyCsljson' },
  { format: 'itemInfo', label: 'libraryCopyItemInfo', separatorBefore: true },
]

/** A client-owned failure whose message is a locale key, not English prose. */
class CopyLocaleError extends Error {
  constructor(readonly key: ZoteroLocaleKey) {
    super(key)
  }
}

/**
 * The text one successful export copies: the requested ref's citation for the
 * citation arm (a single-ref request, so the first entry is the item's own),
 * or the rendered body for every other format.
 */
function copyTextOf(result: ZoteroLibraryExportResultView): string {
  if (result.format !== 'citation') return result.text
  const citation = result.citations[0]
  if (citation === undefined || citation.text === '') {
    throw new CopyLocaleError('libraryCopyCitationEmpty')
  }
  return citation.text
}

/**
 * The client-only item-info block: title, creators, `year · venue`, DOI, and
 * URL lines, with absent optional lines dropped rather than left blank.
 */
export function itemInfoTextOf(detail: ZoteroItemDetailView): string {
  const creators = formatCreatorsList(detail.creators)
  const origin = joinNonEmpty(detail.year, detail.venue)
  return [
    detail.title,
    creators,
    origin,
    detail.doi === undefined ? '' : `DOI: ${detail.doi}`,
    detail.url === undefined ? '' : `URL: ${detail.url}`,
  ]
    .filter((line, index) => index === 0 || line !== '')
    .join('\n')
}

/**
 * The inspector's citation-copy controls.
 * @param props.detail - the inspected record whose citation is copied.
 * @param props.exportItem - the panel's export face; undefined disables wire formats as unavailable.
 * @param props.t - the zotero dictionary.
 */
export function LibraryCitationActions({
  detail,
  exportItem,
  t,
}: {
  readonly detail: ZoteroItemDetailView
  readonly exportItem: LibraryExportItem | undefined
  readonly t: TranslateNS<'zotero'>
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [action, setAction] = useState<CopyAction | undefined>(undefined)
  const { phase, error, copy } = useCopyFeedback(detail.ref)
  const busy = phase === 'pending'
  const wireUnavailable = exportItem === undefined

  useEffect(() => {
    setMenuOpen(false)
    setAction(undefined)
  }, [detail.ref])

  const run = (next: CopyAction): void => {
    if (next === 'itemInfo') {
      setAction(next)
      copy(async () => itemInfoTextOf(detail))
      return
    }
    if (exportItem === undefined) return
    const face = exportItem
    setAction(next)
    copy(async () => {
      const result = await face({ refs: [detail.ref], format: next })
      if (!result.ok) throw result.error
      return copyTextOf(result.value)
    })
  }

  let buttonLabel = t('libraryCitationMenu')
  if (action !== undefined) {
    if (phase === 'pending') {
      buttonLabel = t('libraryExportPending')
    } else if (phase === 'done') {
      buttonLabel = t(DONE_KEY[action])
    }
  }

  let errorText: string | undefined
  if (phase === 'rejected') {
    errorText = t('libraryCopyClipboardUnavailable')
  } else if (phase === 'error') {
    errorText =
      error instanceof CopyLocaleError
        ? t(error.key)
        : t('libraryCopyFailed', { message: messageOf(error) })
  }

  return (
    <>
      <Menu
        open={menuOpen}
        portal
        align="start"
        onClose={() => setMenuOpen(false)}
        anchor={
          <Button
            variant="outline"
            size="sm"
            icon={<IconCopyOutlineRegular size={14} />}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={buttonLabel}
            disabled={busy}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span>{buttonLabel}</span>
            <IconChevronDownOutlineRegular size={12} />
          </Button>
        }
      >
        {ALL_FORMATS.map(({ format, label, separatorBefore }) => (
          <MenuItemButton
            key={format}
            separatorBefore={separatorBefore}
            disabled={busy || (format !== 'itemInfo' && wireUnavailable)}
            onSelect={() => {
              setMenuOpen(false)
              void run(format)
            }}
          >
            {t(label)}
          </MenuItemButton>
        ))}
      </Menu>
      {errorText !== undefined && (
        <span className={css.listError} role="alert">
          {errorText}
        </span>
      )}
    </>
  )
}

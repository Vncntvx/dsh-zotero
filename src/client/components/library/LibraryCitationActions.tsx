/**
 * The inspector action row's citation controls: one button each for the CSL
 * citation and BibTeX arms, and a "more formats" menu for the remaining host
 * formats (bibliography, BibLaTeX, RIS, CSL-JSON) plus a client-only item-info
 * block generated from the inspected record.
 *
 * Every wire copy asks for `refs: [detail.ref]` with no style/locale, so the
 * host's configured rendering defaults decide the text, exactly like the
 * zotero_export tool. The shared {@link useCopyFeedback} lane owns the
 * clipboard write and the stale-answer guards; each action names its own done
 * label, a failure stays inline beside the controls instead of becoming a
 * panel-wide error, and no copy is ever retried.
 * @module dsh-zotero/client/components/library/LibraryCitationActions
 */

import { useEffect, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Button,
  IconChevronDownOutlineRegular,
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

/** The menu's wire formats, in the order the menu lists them. */
const MORE_FORMATS: readonly {
  readonly format: ZoteroLibraryExportFormatView
  readonly label: ZoteroLocaleKey
}[] = [
  { format: 'bibliography', label: 'libraryCopyBibliography' },
  { format: 'biblatex', label: 'libraryCopyBiblatex' },
  { format: 'ris', label: 'libraryCopyRis' },
  { format: 'csljson', label: 'libraryCopyCsljson' },
]

/** The action ids that live behind the more-formats menu. */
const MENU_ACTIONS: ReadonlySet<CopyAction> = new Set<CopyAction>([
  ...MORE_FORMATS.map(({ format }) => format),
  'itemInfo',
])

/** Whether one action is a menu row rather than one of the two buttons. */
function isMenuAction(action: CopyAction): boolean {
  return MENU_ACTIONS.has(action)
}

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
 * @param props.exportItem - the panel's export face; undefined hides the wire formats as unavailable.
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
  // Which control started the shared lane: only it may show the pending/done
  // label, and only while the lane is in that phase.
  const [action, setAction] = useState<CopyAction | undefined>(undefined)
  const { phase, error, copy } = useCopyFeedback(detail.ref)
  const busy = phase === 'pending'
  const wireUnavailable = exportItem === undefined

  // The selection moved on: the open menu and the acting control belong to the
  // previous row; the hook's reset key drops that row's answer.
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
    // The wire controls render disabled without the face; this keeps the
    // handler safe if one is ever invoked programmatically.
    if (exportItem === undefined) return
    const face = exportItem
    setAction(next)
    copy(async () => {
      const result = await face({ refs: [detail.ref], format: next })
      if (!result.ok) throw result.error
      return copyTextOf(result.value)
    })
  }

  const labelFor = (name: CopyAction, normal: ZoteroLocaleKey): string => {
    if (action !== name) return t(normal)
    if (phase === 'pending') return t('libraryExportPending')
    if (phase === 'done') return t(DONE_KEY[name])
    return t(normal)
  }

  let menuFeedback: string | undefined
  if (action !== undefined && isMenuAction(action)) {
    if (phase === 'pending') {
      menuFeedback = t('libraryExportPending')
    } else if (phase === 'done') {
      menuFeedback = t(DONE_KEY[action])
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
      <Button
        variant="outline"
        size="sm"
        disabled={busy || wireUnavailable}
        onClick={() => void run('citation')}
      >
        {labelFor('citation', 'libraryCopyCitation')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || wireUnavailable}
        onClick={() => void run('bibtex')}
      >
        {labelFor('bibtex', 'libraryCopyBibtex')}
      </Button>
      <Menu
        open={menuOpen}
        portal
        align="start"
        onClose={() => setMenuOpen(false)}
        anchor={
          <Button
            variant="outline"
            size="sm"
            icon={<IconChevronDownOutlineRegular size={14} />}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={busy}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {t('libraryCopyMoreFormats')}
          </Button>
        }
      >
        {MORE_FORMATS.map(({ format, label }) => (
          <MenuItemButton
            key={format}
            disabled={busy || wireUnavailable}
            onSelect={() => {
              setMenuOpen(false)
              void run(format)
            }}
          >
            {t(label)}
          </MenuItemButton>
        ))}
        <MenuItemButton
          separatorBefore
          disabled={busy}
          onSelect={() => {
            setMenuOpen(false)
            void run('itemInfo')
          }}
        >
          {t('libraryCopyItemInfo')}
        </MenuItemButton>
      </Menu>
      {menuFeedback !== undefined && (
        <span className={css.statusText} role="status">
          {menuFeedback}
        </span>
      )}
      {errorText !== undefined && (
        <span className={css.listError} role="alert">
          {errorText}
        </span>
      )}
    </>
  )
}

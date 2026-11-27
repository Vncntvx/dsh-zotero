/**
 * The source inspector: the unified grounding feed of the selected source.
 * Eliminates nested tabs in favor of a clean, linear, academic reading flow:
 * title & meta -> action row -> key passages -> export records (if any) -> inline audit panel.
 * @module dsh-zotero/client/components/workspace/SourceInspector
 */

import { useMemo, useRef, useState } from 'react'
import {
  Button,
  IconCopyOutlineRegular,
  IconFolderCloseMedium,
  IconLinkOutlineRegular,
  IconWarningOutlineRegular,
  Tag,
  Toast,
  writeClipboard,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReactNode } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroAttachmentLocationView } from '../../../contract.ts'
import type { SourceWorkspace } from '../../../sources/model.js'
import type { PdfEvidenceTarget } from '../../../reader/evidence.ts'
import { askDraftOf, exportDraftOf } from '../../actions/source-actions.ts'
import { pdfCapabilityOf } from '../../sources/source-capabilities.ts'
import { BlockedReadAction } from '../open/BlockedReadAction.tsx'
import { PdfReadButton } from '../open/PdfReadButton.tsx'
import { MoreActionsMenu } from '../MoreActionsMenu.tsx'
import { selectUrlOf } from '../../actions/open-zotero.ts'
import type { MobilePane } from './ZoteroWorkspaceView.tsx'
import { SourceEvidence } from './SourceEvidence.tsx'
import { SourceExports } from './SourceExports.tsx'
import type { SourcePager } from './useSourcePage.ts'
import css from './workspace.module.css'

interface SourceInspectorProps {
  readonly workspace: SourceWorkspace
  readonly selectedKey: string | undefined
  /** True when the selection is hidden by the active filter. */
  readonly selectionHidden: boolean
  readonly setMobilePane: (pane: MobilePane) => void
  readonly setDraft?: (text: string) => void
  readonly t: TranslateNS<'zotero'>
  readonly openFile?: (path: string) => void
  readonly resolveAttachment?: (ref: string) => Promise<RemoteResult<ZoteroAttachmentLocationView>>
  readonly openProtocol?: (url: string) => Promise<boolean>
  /** The pager that appends the passages behind the feed's head. */
  readonly evidencePager?: SourcePager
  readonly fulltextPager?: SourcePager
  /** The pager that appends the export records behind the list's head. */
  readonly exportsPager?: SourcePager
  /** Open one URL attachment's PDF into the right reader; absent keeps the fallback. */
  readonly openPdf?: (ref: string, evidence?: PdfEvidenceTarget) => Promise<void>
  readonly claimsPanel?: ReactNode
}

/** The inspector: unified grounding feed for the selected source item. */
export function SourceInspector({
  workspace,
  selectedKey,
  selectionHidden,
  setMobilePane,
  setDraft,
  t,
  openFile,
  resolveAttachment,
  openProtocol,
  evidencePager,
  fulltextPager,
  exportsPager,
  openPdf,
  claimsPanel,
}: SourceInspectorProps) {
  const selected = useMemo(
    () => workspace.sources.find((item) => item.key === selectedKey),
    [workspace.sources, selectedKey],
  )

  const itemCollections = useMemo(() => {
    const names = new Set<string>()
    for (const s of selected?.searches ?? []) {
      if (s.scope.kind === 'collection' && s.scope.name) {
        names.add(s.scope.name)
      }
    }
    return Array.from(names)
  }, [selected?.searches])

  const itemTags = useMemo(() => {
    const tags = new Set<string>()
    for (const s of selected?.searches ?? []) {
      for (const tag of s.tags) {
        if (tag.trim() !== '') tags.add(tag)
      }
    }
    return Array.from(tags)
  }, [selected?.searches])

  const [toast, setToast] = useState<{ seq: number; text: string; ok: boolean }>()
  const toastSeq = useRef(0)
  const seat = useRef<HTMLDivElement>(null)

  if (selected === undefined) {
    return (
      <main className={css.inspector}>
        <p className={css.emptyNote}>{t('inspectorEmptyNote')}</p>
      </main>
    )
  }

  const pdfCapability = pdfCapabilityOf(selected)
  const evidenceMatch = selected.evidenceMatch
  const canonicalUrl = selectUrlOf(selected.ref)
  const moreItems: MenuEntry[] = [
    {
      id: 'locate',
      label: t('locateItem'),
      icon: <IconLinkOutlineRegular size={14} />,
      submenu: [
        {
          id: 'copyTitle',
          label: t('copyTitle'),
          disabled: selected.title === undefined || selected.title === '',
        },
        {
          id: 'copyLink',
          label: t('copyZoteroLink'),
          disabled: canonicalUrl === null,
        },
        {
          id: 'openLink',
          label: t('openInZotero'),
          disabled: canonicalUrl === null || openProtocol === undefined,
        },
      ],
    },
  ]
  if (setDraft !== undefined) {
    moreItems.push({
      id: 'export',
      label: t('exportCitation'),
      icon: <IconCopyOutlineRegular size={14} />,
    })
  }
  const report = (outcome: { ok: boolean; text: string }): void => {
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, text: outcome.text, ok: outcome.ok })
  }
  const onMoreSelect = (id: string): void => {
    if (id === 'copyTitle') {
      if (selected.title === undefined) return
      void writeClipboard(selected.title).then(
        (accepted) =>
          report({
            ok: accepted,
            text: accepted ? t('copied') : t('libraryCopyClipboardUnavailable'),
          }),
        () => report({ ok: false, text: t('libraryCopyClipboardUnavailable') }),
      )
      return
    }
    if (id === 'copyLink') {
      if (canonicalUrl === null) return
      void writeClipboard(canonicalUrl).then(
        (accepted) =>
          report({
            ok: accepted,
            text: accepted ? t('copied') : t('libraryCopyClipboardUnavailable'),
          }),
        () => report({ ok: false, text: t('libraryCopyClipboardUnavailable') }),
      )
      return
    }
    if (id === 'openLink') {
      if (canonicalUrl !== null && openProtocol !== undefined) void openProtocol(canonicalUrl)
      return
    }
    if (id === 'export' && setDraft !== undefined) {
      setDraft(exportDraftOf(selected.ref, t))
    }
  }

  return (
    <main className={css.inspector}>
      {/* 1. Header with back button, metadata, and core actions */}
      <div className={css.inspectorHead} data-inspector-panel="overview">
        <Button
          variant="outline"
          size="sm"
          className={css.backSeat}
          onClick={() => {
            setMobilePane('list')
          }}
        >
          {t('backToList')}
        </Button>
        <div className={css.inspectorTitleWrap}>
          <span className={css.inspectorTitle}>{selected.title ?? selected.ref}</span>
          <span className={css.inspectorMeta}>
            {[selected.creators, selected.year, selected.venue].filter(Boolean).join(' · ')}
          </span>
        </div>
        <div className={css.actionRow} ref={seat}>
          {pdfCapability !== null &&
            (evidenceMatch === 'mismatch' ? (
              <BlockedReadAction label={t('readPdf')} t={t} />
            ) : (
              <PdfReadButton
                capability={pdfCapability}
                onOpenFile={openFile}
                resolveAttachment={resolveAttachment}
                label={t('readPdf')}
                t={t}
              />
            ))}
          {setDraft !== undefined && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(askDraftOf(selected.ref, t))
              }}
            >
              {t('askAboutItem')}
            </Button>
          )}
          <MoreActionsMenu label={t('moreActions')} items={moreItems} onSelect={onMoreSelect} />
          {toast !== undefined && (
            <Toast
              key={toast.seq}
              text={toast.text}
              anchor={seat.current}
              {...(toast.ok
                ? { tone: 'success' as const }
                : { icon: <IconWarningOutlineRegular size={14} /> })}
              onDone={() => setToast(undefined)}
            />
          )}
        </div>
      </div>

      {selected.evidenceMatch === 'mismatch' && (
        <p className={css.warning}>{t('databaseMismatch')}</p>
      )}
      {selectionHidden && <p className={css.warning}>{t('selectionHiddenNote')}</p>}

      {/* 2. Metadata overview card: collections and tags */}
      {(itemCollections.length > 0 || itemTags.length > 0) && (
        <div className={css.overviewCard}>
          <div className={css.overviewMetaGrid}>
            {itemCollections.length > 0 && (
              <div className={css.overviewMetaItem}>
                <span className={css.overviewMetaLabel}>{t('overviewScopeCollection')}</span>
                <div className={css.chipRow}>
                  {itemCollections.map((col) => (
                    <Tag key={col} tone="outline" className={css.chip}>
                      <IconFolderCloseMedium size={11} className={css.chipIcon} />
                      <span>{col}</span>
                    </Tag>
                  ))}
                </div>
              </div>
            )}
            {itemTags.length > 0 && (
              <div className={css.overviewMetaItem}>
                <span className={css.overviewMetaLabel}>{t('libraryMetaTags')}</span>
                <div className={css.chipRow}>
                  {itemTags.map((tag) => (
                    <Tag key={tag} tone="neutral" className={css.chip}>
                      <span>#{tag}</span>
                    </Tag>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. Key Passages flow */}
      <div className={css.inspectorBody}>
        <div className={css.section}>
          <h3 className={css.sectionLabel} data-inspector-panel="evidence">
            {t('groundingPassagesTitle')}
            {selected.evidenceTotal > 0 && (
              <span className={css.detailTabCount}>{selected.evidenceTotal}</span>
            )}
          </h3>
          <SourceEvidence
            item={selected}
            t={t}
            openFile={openFile}
            resolveAttachment={resolveAttachment}
            openPdf={openPdf}
            pager={evidencePager}
            fulltextPager={fulltextPager}
          />
          {claimsPanel}
        </div>

        {/* 3. Export Artifacts */}
        <div className={css.section}>
          <h3 className={css.sectionLabel} data-inspector-panel="exports">
            {t('panelExports')}
            {selected.exportsTotal > 0 && (
              <span className={css.detailTabCount}>{selected.exportsTotal}</span>
            )}
          </h3>
          <SourceExports item={selected} t={t} pager={exportsPager} />
        </div>
      </div>
    </main>
  )
}

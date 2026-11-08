/**
 * The source inspector: the unified grounding feed of the selected source.
 * Eliminates nested tabs in favor of a clean, linear, academic reading flow:
 * title & meta -> action row -> key passages -> export records (if any) -> inline audit panel.
 * @module dsh-zotero/client/components/workspace/SourceInspector
 */

import { useMemo } from 'react'
import { Button, IconFolderCloseMedium, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroAttachmentLocationView } from '../../../contract.ts'
import type { SourceWorkspace } from '../../../sources/model.js'
import { askDraftOf, exportDraftOf } from '../../actions/source-actions.ts'
import { pdfCapabilityOf } from '../../sources/source-capabilities.ts'
import { BlockedReadAction } from '../open/BlockedReadAction.tsx'
import { PdfReadButton } from '../open/PdfReadButton.tsx'
import { ZoteroLocateActions } from '../open/ZoteroLocateActions.tsx'
import type { MobilePane } from './ZoteroWorkspaceView.tsx'
import { SourceEvidence } from './SourceEvidence.tsx'
import { SourceExports } from './SourceExports.tsx'
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
}: SourceInspectorProps) {
  const selected = useMemo(
    () => workspace.sources.find((item) => item.key === selectedKey),
    [workspace.sources, selectedKey],
  )

  if (selected === undefined) {
    return (
      <main className={css.inspector}>
        <p className={css.emptyNote}>{t('inspectorEmptyNote')}</p>
      </main>
    )
  }

  const pdfCapability = pdfCapabilityOf(selected)
  const evidenceMatch = selected.evidenceMatch

  const itemCollections = useMemo(() => {
    const names = new Set<string>()
    for (const s of selected.searches) {
      if (s.scope.kind === 'collection' && s.scope.name) {
        names.add(s.scope.name)
      }
    }
    return Array.from(names)
  }, [selected.searches])

  const itemTags = useMemo(() => {
    const tags = new Set<string>()
    for (const s of selected.searches) {
      for (const tag of s.tags) {
        if (tag.trim() !== '') tags.add(tag)
      }
    }
    return Array.from(tags)
  }, [selected.searches])

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
        <div className={css.actionRow}>
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
          <ZoteroLocateActions
            title={selected.title}
            itemRef={selected.ref}
            t={t}
            openProtocol={openProtocol}
          />
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
          {setDraft !== undefined && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(exportDraftOf(selected.ref, t))
              }}
            >
              {t('exportCitation')}
            </Button>
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
            {selected.evidence.length > 0 && (
              <span className={css.detailTabCount}>{selected.evidence.length}</span>
            )}
          </h3>
          <SourceEvidence
            item={selected}
            t={t}
            openFile={openFile}
            resolveAttachment={resolveAttachment}
          />
        </div>

        {/* 3. Export Artifacts */}
        <div className={css.section}>
          <h3 className={css.sectionLabel} data-inspector-panel="exports">
            {t('panelExports')}
            {selected.exports.length > 0 && (
              <span className={css.detailTabCount}>{selected.exports.length}</span>
            )}
          </h3>
          <SourceExports item={selected} t={t} />
        </div>
      </div>
    </main>
  )
}

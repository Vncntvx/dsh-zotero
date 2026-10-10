/**
 * The exports surface shared by the session-wide page and the inspector
 * panel: per-format sections of document rows. Each section head names the
 * format, counts its deduplicated documents, and carries the section-wide
 * copy-all / download-all actions (the joined latest entries); artifacts
 * without per-document data (citation and bibliography calls, legacy
 * projections) render as whole-text call rows inside their format's
 * section, and entries the provider could not locate get a light note with
 * the artifact's full text still downloadable, so a partial failure never
 * hides the documents that did resolve.
 * @module dsh-zotero/client/components/ExportSections
 */

import { useMemo } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ExportArtifact } from '../sources/model.ts'
import { downloadBlob } from '../download.ts'
import { exportSectionsOf, type ExportSection } from '../sources/selectors.ts'
import { CopyButton } from './CopyButton.tsx'
import { ExportDocumentRow } from './ExportDocumentRow.tsx'
import {
  ExportCard,
  extensionOf,
  fileNameForFormat,
  fileNameOf,
  formatLabelOf,
  mimeOf,
} from './ExportCard.tsx'
import css from './cards.module.css'

export interface ExportSectionsProps {
  readonly exports: readonly ExportArtifact[]
  readonly t: TranslateNS<'zotero'>
}

/** The joined entry text of one section, in display order, for copy/download-all. */
export function sectionTextOf(section: ExportSection): string {
  return section.documents.map((document) => document.text).join('\n\n')
}

/** Download one section's joined entries as a single file of the format's extension. */
function downloadSection(section: ExportSection): void {
  downloadBlob(sectionTextOf(section), fileNameForFormat(section.format), mimeOf(section.format))
}

/** Download one artifact's full merged body, for the unlocatable-items note. */
function downloadArtifact(artifact: ExportArtifact): void {
  downloadBlob(artifact.text, fileNameOf(artifact), mimeOf(artifact.format))
}

/** The exports surface: format sections over the successful artifacts. */
export function ExportSections({ exports, t }: ExportSectionsProps) {
  // Sectioning re-parses every artifact body (BibTeX/RIS spans, CSL JSON), so
  // it is keyed on the artifacts rather than redone on each parent render.
  const sections = useMemo(() => exportSectionsOf(exports), [exports])
  return (
    <div className={css.exportStack}>
      {sections.map((section) => (
        <section
          className={css.exportSection}
          key={section.format}
          data-export-format={section.format}
        >
          {section.documents.length > 0 && (
            <header className={css.exportSectionHead}>
              <span className={css.exportSectionTitle}>{formatLabelOf(section.format, t)}</span>
              <span className={css.exportSectionCount}>{section.documents.length}</span>
              <span className={css.exportSectionActions}>
                <CopyButton
                  value={sectionTextOf(section)}
                  label={t('copyAll')}
                  copiedLabel={t('copied')}
                />
                <button
                  type="button"
                  className={css.lineAction}
                  onClick={() => {
                    downloadSection(section)
                  }}
                >
                  {`${t('downloadAll')} ${extensionOf(section.format)}`}
                </button>
              </span>
            </header>
          )}
          {section.documents.map((document) => (
            <ExportDocumentRow key={document.ref} doc={document} t={t} />
          ))}
          {section.unresolvedItems.map((group) => (
            <div className={css.unresolvedItems} key={group.artifact.callId}>
              <span className={css.unresolvedItemsText}>
                {t('unresolvedItemsNote', { count: group.count })}
              </span>
              <button
                type="button"
                className={css.lineAction}
                onClick={() => {
                  downloadArtifact(group.artifact)
                }}
              >
                {`${t('downloadFull')} ${formatLabelOf(group.artifact.format, t)}`}
              </button>
            </div>
          ))}
          {section.unresolved.map((artifact) => (
            <ExportCard key={artifact.callId} artifact={artifact} t={t} />
          ))}
        </section>
      ))}
    </div>
  )
}

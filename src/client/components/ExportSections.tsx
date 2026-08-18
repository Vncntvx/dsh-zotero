/**
 * The exports surface shared by the session-wide page and the inspector
 * panel: per-format sections of document rows. Each section head names the
 * format, counts its deduplicated documents, and carries the section-wide
 * copy-all / download-all actions (the joined latest entries); artifacts
 * without per-document data — citation and bibliography calls, legacy
 * projections — render as whole-text call rows inside their format's
 * section, so the page never hides a successful export.
 * @module dsh-zotero/client/components/ExportSections
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ExportArtifact } from '../sources/model.ts'
import { exportSectionsOf, type ExportSection } from '../sources/selectors.ts'
import { CopyButton } from './CopyButton.tsx'
import { ExportDocumentRow } from './ExportDocumentRow.tsx'
import { ExportCard, extensionOf, formatLabelOf, mimeOf } from './ExportCard.tsx'
import css from './SourcesList.module.css'

export interface ExportSectionsProps {
  readonly exports: readonly ExportArtifact[]
  readonly t: TranslateNS<'zotero'>
}

/** The joined entry text of one section, in display order — copy/download-all content. */
export function sectionTextOf(section: ExportSection): string {
  return section.documents.map((document) => document.text).join('\n\n')
}

/** Download one section's joined entries as a single file of the format's extension. */
function downloadSection(section: ExportSection): void {
  const blob = new Blob([sectionTextOf(section)], { type: mimeOf(section.format) })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  // A section with documents always carries a named translator format; the
  // extension lookup keeps the fallback for unknown ids.
  anchor.href = url
  anchor.download = `zotero-${section.format}${extensionOf(section.format)}`
  anchor.click()
  // The blob URL must not outlive the click.
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}

/** The exports surface: format sections over the successful artifacts. */
export function ExportSections({ exports, t }: ExportSectionsProps) {
  const sections = exportSectionsOf(exports)
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
          {section.unresolved.map((artifact) => (
            <ExportCard key={artifact.callId} artifact={artifact} t={t} />
          ))}
        </section>
      ))}
    </div>
  )
}

/**
 * The citations lens: the session's export artifacts as takeable output —
 * one compact card per export (format chip, extracted keys preview, copy
 * affordances, and a one-click \cite{…} command over the extracted keys for
 * BibTeX/BibLaTeX bodies) with the full body collapsed behind a toggle, so a
 * single-citation query never floods the panel — plus a quick-access row per
 * corpus item (copy the ref, or prefill a generate-citation instruction
 * through the injected setDraft; never submits). The quick-access rows
 * come from the stable session literature, so citing one paper never hides
 * the rest.
 * @module dsh-zotero/client/ZoteroCiteLens
 */

import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { bibTexKeysOf, citeCommandOf, type Corpus, type CorpusExport } from './corpus.ts'
import { displayRefOf, interpolate, joinNonEmpty } from './presenters.ts'
import { CopyValue, ExportBody } from './ZoteroToolViews.tsx'
import viewsCss from './ZoteroToolViews.module.css'
import css from './ZoteroCiteLens.module.css'

export interface ZoteroCiteLensProps {
  readonly corpus: Corpus
  readonly t: TranslateNS<'zotero'>
  /** Composer prefill from the host props; absent in composer-less mounts. */
  readonly setDraft?: (text: string) => void
}

/**
 * One export artifact: a one-line head (format, style, extracted keys, copy
 * affordances) with the full body collapsed behind a chevron. The head stays
 * compact per artifact — the takeaway is the keys and the copy buttons; the
 * body is one click away, never truncated.
 */
function ExportCard({
  artifact,
  t,
}: {
  readonly artifact: CorpusExport
  readonly t: ZoteroCiteLensProps['t']
}) {
  // The keys derive from the artifact's immutable text; scanning the full
  // body again on every re-render would be wasted work.
  const keys = useMemo(() => bibTexKeysOf(artifact.text), [artifact.text])
  const cite = citeCommandOf(keys)
  const [open, setOpen] = useState(false)
  return (
    <div className={css.exportCard}>
      <div className={css.exportHead}>
        <span className={css.exportFormat}>{artifact.format}</span>
        {artifact.style !== undefined && <span className={css.exportStyle}>{artifact.style}</span>}
        {keys.length > 0 && (
          <code className={css.citePreview} title={keys.join(', ')}>
            {keys.join(' · ')}
          </code>
        )}
        <span className={css.spacer} />
        <CopyValue value={artifact.text} t={t} label={t('copyFullText')} />
        {cite !== '' && <CopyValue value={cite} t={t} label={t('copyCite')} />}
        <button
          type="button"
          className={css.toggleButton}
          aria-expanded={open}
          aria-label={open ? t('artifactCollapseLabel') : t('artifactExpandLabel')}
          onClick={() => {
            setOpen((value) => !value)
          }}
        >
          <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
        </button>
      </div>
      {open && (
        <ExportBody
          format={artifact.format === '' ? undefined : artifact.format}
          text={artifact.text}
          t={t}
          copy={false}
        />
      )}
    </div>
  )
}

/** The citations lens: export artifacts above, per-item quick access below. */
export function ZoteroCiteLens({ corpus, t, setDraft }: ZoteroCiteLensProps) {
  return (
    <>
      {/* The section labels are direct children of the tab's list, so they
          share the caption geometry of the items and activity lenses. */}
      <span className={css.sectionLabel}>{t('exportsLabel')}</span>
      <section className={css.section}>
        {corpus.exports.length === 0 ? (
          <div className={css.noExports}>
            <p className={css.noExportsText}>{t('noExportsHint')}</p>
            {setDraft !== undefined && (
              <button
                type="button"
                className={viewsCss.actionButton}
                onClick={() => {
                  setDraft(t('starterCiteTemplate'))
                }}
              >
                {t('starterCite')}
              </button>
            )}
          </div>
        ) : (
          corpus.exports.map((artifact) => (
            <ExportCard key={artifact.callId} artifact={artifact} t={t} />
          ))
        )}
      </section>
      {corpus.literature.length > 0 && (
        <>
          <span className={css.sectionLabel}>{t('quickAccessLabel')}</span>
          <section className={css.section}>
            {corpus.literature.map((item) => {
              const summary = joinNonEmpty(item.creators, item.year)
              return (
                <div key={item.key} className={css.quickRow}>
                  <span className={css.quickTitle} title={item.title ?? item.ref}>
                    {item.title ?? displayRefOf(item.ref)}
                  </span>
                  <span className={css.quickMeta} title={summary}>
                    {summary}
                  </span>
                  <CopyValue value={item.ref} t={t} label={t('copyRef')} />
                  {setDraft !== undefined && (
                    <button
                      type="button"
                      className={viewsCss.actionButton}
                      onClick={() => {
                        setDraft(interpolate(t('citeTemplate'), { ref: item.ref }))
                      }}
                    >
                      {t('generateCitation')}
                    </button>
                  )}
                </div>
              )
            })}
          </section>
        </>
      )}
    </>
  )
}

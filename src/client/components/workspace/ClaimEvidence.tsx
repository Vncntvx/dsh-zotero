import { useMemo, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { EvidencePassage, SourceItem } from '../../../sources/model.ts'
import type { PdfEvidenceTarget } from '../../../reader/evidence.ts'
import { passagePdfTarget } from './SourceEvidence.tsx'
import {
  CLAIM_RELATIONS,
  EVIDENCE_REVIEWS,
  claimLinkOf,
  claimPassageKey,
  linkClaim,
  readClaims,
  writeClaims,
} from './claim-evidence.ts'
import css from './workspace.module.css'

const RELATION_LABEL = {
  supports: 'claimSupports',
  refutes: 'claimRefutes',
  limits: 'claimLimits',
  uncertain: 'claimUncertain',
  result: 'claimResult',
} as const
const REVIEW_LABEL = {
  unreviewed: 'claimUnreviewed',
  verified: 'claimVerified',
  disputed: 'claimDisputed',
} as const

interface Props {
  readonly sessionId: string
  readonly source: SourceItem
  readonly t: TranslateNS<'zotero'>
  readonly selectSource?: (key: string) => void
  readonly canSelectSource?: (key: string) => boolean
  readonly openPdf?: (ref: string, evidence?: PdfEvidenceTarget) => Promise<void>
}

export function ClaimEvidence({
  sessionId,
  source,
  t,
  selectSource,
  canSelectSource,
  openPdf,
}: Props) {
  const [claims, setClaims] = useState(() => readClaims(sessionId))
  const [claimId, setClaimId] = useState('')
  const [message, setMessage] = useState<
    'claimSaved' | 'claimMemoryOnly' | 'claimLimit' | 'libraryPdfReaderUnavailable'
  >()
  const [memoryOnly, setMemoryOnly] = useState(false)
  const [statementInvalid, setStatementInvalid] = useState(false)
  const projectedPassages = useMemo(() => {
    const byKey = new Map<string, EvidencePassage | undefined>()
    for (const passage of source.evidence) {
      const key = claimPassageKey(claimLinkOf(source.key, passage, 'uncertain', 'unreviewed'))
      byKey.set(key, byKey.has(key) ? undefined : passage)
    }
    return byKey
  }, [source.evidence, source.key])

  return (
    <details className={`${css.disclosure} ${css.panel}`}>
      <summary>{t('claimEvidence')}</summary>
      {claims.map((claim) => (
        <details key={claim.id} className={css.disclosure}>
          <summary>{claim.text}</summary>
          <ul>
            {claim.evidence.map((link, index) => {
              const passage = projectedPassages.get(claimPassageKey(link))
              const location = passage ? passagePdfTarget(passage, source) : undefined
              const ref = location?.ref
              return (
                <li key={index}>
                  <blockquote className={css.quoteBody}>{link.passage}</blockquote>
                  <p className={css.note}>
                    {t(RELATION_LABEL[link.relation])} · {t(REVIEW_LABEL[link.review])}
                    {link.pageIndex !== undefined &&
                      ` · ${t('claimPhysicalPage', { page: link.pageIndex + 1 })}`}
                  </p>
                  {selectSource && canSelectSource?.(link.sourceItem) ? (
                    <Button size="sm" onClick={() => selectSource(link.sourceItem)}>
                      {link.sourceRef}
                    </Button>
                  ) : (
                    <p className={css.note}>{link.sourceRef}</p>
                  )}
                  {openPdf && ref && location?.evidence && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setMessage(undefined)
                        void openPdf(ref, location.evidence).catch(() =>
                          setMessage('libraryPdfReaderUnavailable'),
                        )
                      }}
                    >
                      {t('jumpToPageInSidebar')}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </details>
      ))}
      {!!source.evidence.length && (
        <section className={css.claimComposer}>
          <h4 className={css.claimHeading}>{t('claimAddEvidence')}</h4>
          <form
            className={css.claimForm}
            aria-label={t('claimAddEvidence')}
            onSubmit={(event) => {
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              const passage = source.evidence[Number(data.get('passage'))]
              const relation = CLAIM_RELATIONS.find((value) => value === data.get('relation'))
              const review = EVIDENCE_REVIEWS.find((value) => value === data.get('review'))
              if (!passage || !relation || !review) return
              const link = claimLinkOf(source.key, passage, relation, review)
              const baseline = memoryOnly ? claims : readClaims(sessionId)
              const next = linkClaim(baseline, claimId, String(data.get('statement') ?? ''), link)
              if (!next) {
                setMessage('claimLimit')
                return
              }
              const retained = writeClaims(sessionId, next)
              setMemoryOnly(!retained)
              setClaims(next)
              setClaimId(claimId || next.at(-1)?.id || '')
              setMessage(retained ? 'claimSaved' : 'claimMemoryOnly')
            }}
          >
            <label className={css.claimField}>
              <span>{t('claimChoose')}</span>
              <select
                className={css.claimControl}
                name="claim"
                value={claimId}
                onChange={(event) => {
                  setClaimId(event.target.value)
                  setStatementInvalid(false)
                }}
              >
                <option value="">{t('claimNew')}</option>
                {claims.map((claim) => (
                  <option key={claim.id} value={claim.id}>
                    {claim.text}
                  </option>
                ))}
              </select>
            </label>
            {!claimId && (
              <label className={css.claimField}>
                <span>{t('claimStatement')}</span>
                <textarea
                  className={css.claimControl}
                  name="statement"
                  rows={2}
                  required
                  maxLength={500}
                  aria-invalid={statementInvalid || undefined}
                  aria-describedby={statementInvalid ? 'claim-statement-error' : undefined}
                  onInvalid={() => setStatementInvalid(true)}
                  onChange={() => setStatementInvalid(false)}
                />
                {statementInvalid && (
                  <span id="claim-statement-error" className={css.claimError}>
                    {t('claimStatementRequired')}
                  </span>
                )}
              </label>
            )}
            <label className={css.claimField}>
              <span>{t('claimPassage')}</span>
              <select className={css.claimControl} name="passage">
                {source.evidence.map((passage, index) => (
                  <option key={index} value={index}>
                    {passage.text.slice(0, 100) || passage.sourceRef}
                  </option>
                ))}
              </select>
            </label>
            <label className={css.claimField}>
              <span>{t('claimRelation')}</span>
              <select className={css.claimControl} name="relation">
                {CLAIM_RELATIONS.map((relation) => (
                  <option key={relation} value={relation}>
                    {t(RELATION_LABEL[relation])}
                  </option>
                ))}
              </select>
            </label>
            <label className={css.claimField}>
              <span>{t('claimReview')}</span>
              <select className={css.claimControl} name="review">
                {EVIDENCE_REVIEWS.map((review) => (
                  <option key={review} value={review}>
                    {t(REVIEW_LABEL[review])}
                  </option>
                ))}
              </select>
            </label>
            <div className={css.claimActions}>
              <Button size="sm" variant="primary" type="submit">
                {t('claimAddEvidence')}
              </Button>
            </div>
          </form>
        </section>
      )}
      {message && <p role="status">{t(message)}</p>}
    </details>
  )
}

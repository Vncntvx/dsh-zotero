import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ZoteroBatchParseView } from '../../contract.ts'
import css from '../fields.module.css'

export function batchDone(batch: ZoteroBatchParseView) {
  return batch.parsed + batch.reused + batch.failed
}

export function BatchProgressBar({
  batch,
  t,
}: {
  batch: ZoteroBatchParseView
  t: TranslateNS<'zotero'>
}) {
  const done = batchDone(batch)
  return (
    <div
      className={css.progressTrack}
      role="progressbar"
      aria-label={t('batchProgress')}
      aria-valuemin={0}
      aria-valuemax={batch.total}
      aria-valuenow={done}
    >
      <div className={css.progressFill} style={{ width: `${(done / batch.total) * 100}%` }} />
    </div>
  )
}

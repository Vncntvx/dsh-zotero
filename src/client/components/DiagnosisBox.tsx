import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { formatDiagnosis } from './plugin/diagnosis.ts'
import css from './DiagnosisBox.module.css'

export interface DiagnosisBoxProps {
  readonly diagnosis: string
  readonly t: TranslateNS<'zotero'>
}

/**
 * Shared diagnosis box rendering a categorized error message and raw code.
 */
export function DiagnosisBox({ diagnosis, t }: DiagnosisBoxProps): ReactNode {
  const formatted = formatDiagnosis(diagnosis, t)
  return (
    <div className={css.diagnosisBox} data-zotero-diagnosis-box>
      <div className={css.diagnosisHead}>
        <span className={css.diagnosisLabelText}>{t('diagnosisLabel')}:</span>
        {formatted.rawCode ? <code className={css.diagnosisCode}>{formatted.rawCode}</code> : null}
      </div>
      <p className={css.diagnosisMessage}>{formatted.message}</p>
    </div>
  )
}

/** File results are read by persisted event coordinates before copying or downloading. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useCompleteResult } from '../components/useCompleteResult.ts'
import { metaOf } from '../presenters.ts'
import { CopyButton } from '../components/CopyButton.tsx'
import { downloadBlob } from '../download.ts'
import { RESULT_PREVIEW_CHARS, fileNameForFormat, mimeOf } from '../export-formats.ts'
import css from './toolviews.module.css'
import quiet from '../components/quiet.module.css'

type Props = PropsRuntime<'tool.call.toolview'> & PropsLocale<'zotero'>
export function FileResultView(props: Props) {
  const sessionId = props.useSession((snapshot) => snapshot.sessionId)
  const seq = 'seq' in props.block ? props.block.seq : -1
  return <FileResultBody key={`${sessionId}:${seq}`} {...props} sessionId={sessionId} />
}
function FileResultBody(props: Props & { sessionId: string }) {
  const meta = metaOf(props.block)
  const coordinates = 'seq' in props.block ? { seq: props.block.seq, index: 0 } : undefined
  const { state, load } = useCompleteResult({
    sessionId: props.sessionId,
    coordinates,
    requireExportText: props.toolName === 'zotero_export',
    failureMessage: props.t('resultReadFailed'),
  })
  return (
    <div className={css.codeWrap}>
      <div className={css.coverageNotice}>
        {typeof meta?.summary === 'string' ? meta.summary : props.t('resultStored')}
      </div>
      <button
        type="button"
        className={quiet.quietDense}
        disabled={state.loading}
        onClick={() => {
          void load()
        }}
      >
        {props.t('readCompleteResult')}
      </button>
      {state.error && <div role="alert">{state.error}</div>}
      {state.body !== undefined && (
        <>
          <CopyButton
            value={state.body.text}
            label={props.t('copy')}
            copiedLabel={props.t('copied')}
            className={quiet.quietDense}
          />
          <button
            type="button"
            className={quiet.quietDense}
            onClick={() =>
              downloadBlob(
                state.body!.text,
                fileNameForFormat(state.body!.format),
                mimeOf(state.body!.format),
              )
            }
          >
            {props.t('downloadArtifact')}
          </button>
          {state.body.text.length > RESULT_PREVIEW_CHARS && (
            <div>{props.t('exportDisplayPreview')}</div>
          )}
          <pre className={css.codeBox}>{state.body.text.slice(0, RESULT_PREVIEW_CHARS)}</pre>
        </>
      )}
    </div>
  )
}

/** Standalone parse surface. The composition root supplies committed capabilities and host ports. */
import { useEffect, useId, useMemo, useRef, useSyncExternalStore } from 'react'
import {
  Button,
  Input,
  Modal,
  IconDeliverDocRegular,
  IconRefreshOutlineRegular,
  IconStopFillRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  DocumentParseController,
  documentParseProgress,
  documentParseText,
  type DocumentParseCapabilities,
  type DocumentParseJobs,
  type DocumentParseRemote,
  type DocumentParseSelection,
  type DocumentParseState,
  type ParseSnapshotSource,
} from './parse-controller.ts'
import { formatParseFileLimit, type ParseTranslate, type ParseLocaleKey } from './parse-locales.ts'
import css from './parse.module.css'
import noticeCss from '../components/notice.module.css'

interface ParseDocumentDialogProps {
  readonly open: boolean
  readonly selection: DocumentParseSelection
  readonly remote: DocumentParseRemote
  readonly jobs: DocumentParseJobs | undefined
  readonly capabilities: ParseSnapshotSource<DocumentParseCapabilities>
  readonly onClose: () => void
  readonly deploymentError?: string
  /** Opens the committed artifact in its own reading tab; absent when enrichment reads are off. */
  readonly onOpenParsed?: (sessionId: string, artifactId: string, title: string) => void
  readonly t: ParseTranslate
}

/** The only start action is a user form submission; opening only inspects artifacts. */
export function ParseDocumentDialog(props: ParseDocumentDialogProps) {
  const { remote, jobs, capabilities, selection, open, onClose, onOpenParsed } = props
  const controller = useMemo(
    () => new DocumentParseController(remote, jobs, capabilities),
    [remote, jobs, capabilities],
  )
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const t = props.t
  const formId = useId()
  const inputId = useId()
  const hintId = useId()
  const targetKey = JSON.stringify(selection)
  const latestSelection = useRef(selection)
  latestSelection.current = selection

  useEffect(() => controller.connect(), [controller])
  useEffect(() => {
    if (open) controller.open(latestSelection.current)
    else controller.close()
    return () => controller.close()
  }, [controller, open, targetKey])

  const close = () => {
    controller.close()
    onClose()
  }
  // The receipt's artifact id addresses the reading tab for every target kind
  // (attachment, URL, or reused artifact); the dialog closes once the
  // panel opens. The label names the chip and the downloaded Markdown file.
  const readMarkdown = (artifactId: string, title: string) => {
    if (!onOpenParsed) return
    onOpenParsed(selection.sessionId, artifactId, title)
    close()
  }
  const receipt = state.receipt
  const completed = receipt?.kind === 'completed'
  const retryable = receipt?.kind === 'failed' || receipt?.kind === 'cancelled'
  const canSubmit =
    state.gate === 'ready' && !state.submitting && (!state.operation || completed || retryable)
  const action = retryable
    ? 'retry'
    : completed || state.artifact?.kind === 'ready'
      ? 'reparse'
      : 'parse'
  const live = !!state.operation && !completed && !retryable
  const cancelDisabled =
    !state.operation?.jobId ||
    !state.capabilities.cancelAllowed ||
    !state.capabilities.sessionAllowed ||
    !state.capabilities.connected ||
    state.cancelling ||
    state.cancelRequested ||
    state.job?.status === 'stopping' ||
    state.job?.status === 'completed' ||
    state.job?.status === 'failed' ||
    state.job?.status === 'killed'
  const progress = documentParseProgress(state)
  const failed = receipt?.kind === 'failed'
  const cancelled = receipt?.kind === 'cancelled'
  const jobTerminal =
    state.job !== undefined && ['completed', 'failed', 'killed'].includes(state.job.status)
  const statusKey: ParseLocaleKey = completed
    ? 'parseCompleted'
    : state.job
      ? ({
          running: 'parseRunning',
          stopping: 'parseStopping',
          completed: 'parseCompleted',
          failed: 'parseFailed',
          killed: 'parseKilled',
        }[state.job.status] as ParseLocaleKey)
      : state.submitting
        ? 'parseSubmitting'
        : 'parseWaiting'

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('parseTitle')}
      closeLabel={t('parseClose')}
      className={css.card}
      contentClassName={css.content}
      footer={
        <div className={css.footer}>
          <Button
            type="button"
            icon={<IconRefreshOutlineRegular />}
            onClick={() => void controller.refresh()}
            disabled={
              !state.capabilities.mounted ||
              !state.capabilities.connected ||
              !state.capabilities.sessionAllowed ||
              !state.capabilities.readAllowed ||
              !state.valid ||
              state.checking
            }
          >
            {t('parseReconnect')}
          </Button>
          {live && (
            <Button
              type="button"
              icon={<IconStopFillRegular />}
              onClick={() => void controller.cancel()}
              disabled={cancelDisabled}
            >
              {t('parseCancel')}
            </Button>
          )}
          {(!state.operation || completed || retryable) && (
            <Button form={formId} type="submit" variant="primary" disabled={!canSubmit}>
              {t(
                action === 'retry'
                  ? 'parseRetry'
                  : action === 'reparse'
                    ? 'parseReparse'
                    : 'parseConfirm',
              )}
            </Button>
          )}
        </div>
      }
    >
      {props.deploymentError && (
        <p role="alert" className={`${noticeCss.notice} ${noticeCss.noticeError}`}>
          {props.deploymentError}
        </p>
      )}
      <form
        id={formId}
        className={css.surface}
        onSubmit={(event) => {
          event.preventDefault()
          if (canSubmit) void controller.submit(action)
        }}
      >
        <div className={css.body}>
          {state.target.kind === 'url' && (
            <div className={css.field}>
              <label htmlFor={inputId}>{t('parseUrl')}</label>
              <Input
                id={inputId}
                type="url"
                value={state.target.url}
                onChange={(event) => controller.setTarget({ kind: 'url', url: event.target.value })}
                aria-describedby={hintId}
                aria-invalid={!state.valid}
                autoComplete="off"
                spellCheck={false}
                data-modal-autofocus
              />
              <p id={hintId} className={css.secondary}>
                {t('parseUrlHint')}
              </p>
            </div>
          )}
          <dl className={css.facts}>
            <dt>{t('parseTarget')}</dt>
            <dd data-parse-target-label>{state.targetLabel || '—'}</dd>
            <dt>{t('parseProvider')}</dt>
            <dd>{t('parseProviderValue')}</dd>
            <dt>{t('parseMode')}</dt>
            <dd>{t(state.capabilities.mode === 'pro' ? 'parseModePro' : 'parseModeFree')}</dd>
          </dl>
          {/* The limits, the gates, and the close hint are one note block:
           * what applies to this submission, divided from the facts above. */}
          <div className={css.notes}>
            {state.capabilities.maxFileBytes > 0 && (
              <p className={css.secondary}>
                {t('parseLimits', {
                  size: formatParseFileLimit(state.capabilities.maxFileBytes),
                  pages: state.capabilities.maxPages,
                })}
              </p>
            )}
            <GateNotice state={state} t={t} />
            {state.checking && (
              <p role="status" className={`${noticeCss.notice} ${noticeCss.noticeStatus}`}>
                {t('parseChecking')}
              </p>
            )}
            {!completed && !failed && !cancelled && (
              <p className={css.secondary}>{t('parseCloseHint')}</p>
            )}
          </div>
          {state.failure && (
            <p role="alert" className={`${noticeCss.notice} ${noticeCss.noticeError} ${css.error}`}>
              <code>{documentParseText(state.failure.code)}</code>{' '}
              {documentParseText(state.failure.message)}
            </p>
          )}
          {state.artifact?.kind === 'expired' && <p>{t('parseArtifactExpired')}</p>}
          {state.artifact?.kind === 'ready' && <Artifact artifact={state.artifact} t={t} />}
          {state.operation && (
            <section className={css.result} aria-live="polite">
              <p
                role={failed ? 'alert' : 'status'}
                className={
                  failed
                    ? `${noticeCss.notice} ${noticeCss.noticeError} ${css.error}`
                    : `${noticeCss.notice} ${noticeCss.noticeStatus}`
                }
              >
                {cancelled ? (
                  t('parseKilled')
                ) : failed ? (
                  <>
                    {t('parseFailed')} · <code>{documentParseText(receipt.code)}</code>{' '}
                    {documentParseText(receipt.message)}
                  </>
                ) : state.cancelRequested ? (
                  t('parseCancelRequested')
                ) : (
                  ((jobTerminal ? undefined : progress) ??
                  t(state.job?.status === 'running' ? 'parseInProgress' : statusKey))
                )}
              </p>
              {state.observationError && <p className={css.error}>{t('parseReconnectHint')}</p>}
              {receipt?.kind === 'completed' && (
                <>
                  <p>{t(receipt.receipt.cached ? 'parseCached' : 'parseFresh')}</p>
                  <dl className={css.facts}>
                    <dt>{t('parseCharacters')}</dt>
                    <dd>{receipt.receipt.characterCount}</dd>
                    <dt>{t('parsePages')}</dt>
                    <dd>{receipt.receipt.pageCount ?? t('parsePagesUnknown')}</dd>
                  </dl>
                  {onOpenParsed && (
                    <ReadMarkdown
                      artifactId={receipt.receipt.artifactId}
                      title={receipt.receipt.targetLabel || state.targetLabel}
                      open={readMarkdown}
                      t={t}
                    />
                  )}
                </>
              )}
            </section>
          )}
        </div>
      </form>
    </Modal>
  )
}

function GateNotice({ state, t }: { state: DocumentParseState; t: ParseTranslate }) {
  const key: Partial<Record<DocumentParseState['gate'], ParseLocaleKey>> = {
    'not-available': 'parseUnavailable',
    permission: 'parsePermission',
    offline: 'parseOffline',
    invalid: 'parseInvalid',
  }
  const notice = key[state.gate]
  return (
    <>
      {notice && (
        <p role="status" className={`${noticeCss.notice} ${noticeCss.noticeStatus}`}>
          {t(notice)}
        </p>
      )}
      {!state.capabilities.readAllowed && (
        <p role="status" className={`${noticeCss.notice} ${noticeCss.noticeStatus}`}>
          {t('parseReadPermission')}
        </p>
      )}
    </>
  )
}

function Artifact({
  artifact,
  t,
}: {
  artifact: Extract<DocumentParseState['artifact'], { kind: 'ready' }>
  t: ParseTranslate
}) {
  return (
    <section className={css.result}>
      <p>{t('parseArtifactReady')}</p>
      <dl className={css.facts}>
        <dt>{t('parseCharacters')}</dt>
        <dd>{artifact.characterCount}</dd>
        <dt>{t('parsePages')}</dt>
        <dd>{artifact.pageCount ?? t('parsePagesUnknown')}</dd>
      </dl>
    </section>
  )
}

/**
 * Opens the receipt's artifact in a dedicated right-sidebar reading tab,
 * displaying the complete document and figures.
 */
function ReadMarkdown({
  artifactId,
  title,
  open,
  t,
}: {
  artifactId: string
  title: string
  open: (artifactId: string, title: string) => void
  t: ParseTranslate
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      icon={<IconDeliverDocRegular size={14} />}
      onClick={() => open(artifactId, title)}
    >
      {t('parseReadMarkdown')}
    </Button>
  )
}

/** Standalone parse surface. The composition root supplies committed capabilities and host ports. */
import { useEffect, useId, useMemo, useRef, useSyncExternalStore } from 'react'
import {
  Button,
  Input,
  Modal,
  IconCloseOutlineRegular,
  IconRefreshOutlineRegular,
  IconStopFillRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { IconButton } from '../components/IconButton.tsx'
import {
  DocumentParseController,
  documentParseProgress,
  documentParseText,
  type DocumentParseCapabilities,
  type DocumentParseJobs,
  type DocumentParseOperation,
  type DocumentParseRemote,
  type DocumentParseSelection,
  type DocumentParseState,
  type ParseSnapshotSource,
} from './parse-controller.ts'
import { parseTranslate, type ParseTranslate, type ParseLocaleKey } from './parse-locales.ts'
import css from './parse.module.css'

export interface ParseDocumentDialogProps {
  readonly open: boolean
  readonly selection: DocumentParseSelection
  readonly remote: DocumentParseRemote
  readonly jobs: DocumentParseJobs | undefined
  readonly capabilities: ParseSnapshotSource<DocumentParseCapabilities>
  readonly onClose: () => void
  /** Persist an accepted operation for reopening, including admission after this view closes. */
  readonly onOperation?: (
    operation: DocumentParseOperation,
    selection: DocumentParseSelection,
  ) => void
  readonly locale?: 'zh' | 'en'
  /** Persist the ID before RPC send; an intent is not an admission verdict. */
  readonly onOperationIntent?: (
    operation: Pick<DocumentParseOperation, 'operationId'>,
    selection: DocumentParseSelection,
  ) => void
  readonly t?: ParseTranslate
}

/** The only start action is a user form submission; opening only inspects artifacts. */
export function ParseDocumentDialog(props: ParseDocumentDialogProps) {
  const { remote, jobs, capabilities, selection, open, onClose } = props
  const operationListener = useRef(props.onOperation)
  const intentListener = useRef(props.onOperationIntent)
  operationListener.current = props.onOperation
  intentListener.current = props.onOperationIntent
  const controller = useMemo(
    () =>
      new DocumentParseController(
        remote,
        jobs,
        capabilities,
        (operation, selected) => operationListener.current?.(operation, selected),
        (operation, selected) => intentListener.current?.(operation, selected),
      ),
    [remote, jobs, capabilities],
  )
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const t = useMemo(() => props.t ?? parseTranslate(props.locale ?? 'zh'), [props.t, props.locale])
  const inputId = useId()
  const hintId = useId()
  const targetKey = JSON.stringify(selection)

  useEffect(() => controller.connect(), [controller])
  useEffect(() => {
    if (open) controller.open(selection)
    else controller.close()
    return () => controller.close()
  }, [controller, open, targetKey])

  const close = () => {
    controller.close()
    onClose()
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
  const statusKey: ParseLocaleKey = completed
    ? 'parseCompleted'
    : retryable
      ? receipt.kind === 'failed'
        ? 'parseFailed'
        : 'parseKilled'
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
    <Modal open={open} onClose={close} title={t('parseTitle')} headless>
      <form
        className={css.surface}
        onSubmit={(event) => {
          event.preventDefault()
          if (canSubmit) void controller.submit(action)
        }}
      >
        <header className={css.header}>
          <h2 className={css.title}>{t('parseTitle')}</h2>
          <IconButton
            icon={<IconCloseOutlineRegular />}
            aria-label={t('parseClose')}
            onClick={close}
            type="button"
          />
        </header>
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
            <dd data-parse-target-label>{state.targetLabel}</dd>
            <dt>{t('parseProvider')}</dt>
            <dd>{t('parseProviderValue')}</dd>
            <dt>{t('parseMode')}</dt>
            <dd>{t(state.capabilities.mode === 'pro' ? 'parseModePro' : 'parseModeFree')}</dd>
          </dl>
          <p>{t('parseUploadMeaning')}</p>
          <p>
            {t('parseLimits', {
              bytes: state.capabilities.maxFileBytes,
              pages: state.capabilities.maxPages,
            })}
          </p>
          <p className={css.secondary}>{t('parseNoSemantic')}</p>
          <GateNotice state={state} t={t} />
          {state.checking && <p role="status">{t('parseChecking')}</p>}
          {state.failure && (
            <p role="alert" className={css.error}>
              <code>{documentParseText(state.failure.code)}</code>{' '}
              {documentParseText(state.failure.message)}
            </p>
          )}
          {state.artifact && <Artifact state={state} t={t} />}
          {state.operation && (
            <section className={css.result} aria-live="polite">
              <p role="status">{t(statusKey)}</p>
              {progress && <p data-parse-progress>{progress}</p>}
              {state.cancelRequested && <p>{t('parseCancelRequested')}</p>}
              {state.observationError && <p className={css.error}>{t('parseReconnectHint')}</p>}
              {receipt?.kind === 'pending' && <p>{t('parseReceiptPending')}</p>}
              {(receipt?.kind === 'failed' || receipt?.kind === 'cancelled') && (
                <p role="alert" className={css.error}>
                  {t(receipt.kind === 'failed' ? 'parseFailed' : 'parseKilled')} ·{' '}
                  <code>{documentParseText(receipt.code)}</code>{' '}
                  {documentParseText(receipt.message)}
                </p>
              )}
              {receipt?.kind === 'completed' && (
                <>
                  <p>{t(receipt.receipt.cached ? 'parseCached' : 'parseFresh')}</p>
                  <dl className={css.facts}>
                    <dt>{t('parseGeneration')}</dt>
                    <dd>{receipt.receipt.generation}</dd>
                    <dt>{t('parseArtifact')}</dt>
                    <dd>{receipt.receipt.artifactId}</dd>
                    <dt>{t('parseFingerprint')}</dt>
                    <dd>{receipt.receipt.fingerprint}</dd>
                    <dt>{t('parseCharacters')}</dt>
                    <dd>{receipt.receipt.characterCount}</dd>
                    <dt>{t('parsePages')}</dt>
                    <dd>{receipt.receipt.pageCount ?? t('parsePagesUnknown')}</dd>
                  </dl>
                  <p>{t('parsePreview')}</p>
                  <pre className={css.preview}>{receipt.receipt.preview}</pre>
                </>
              )}
            </section>
          )}
          <p className={css.secondary}>{t('parseCloseHint')}</p>
        </div>
        <footer className={css.footer}>
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
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {t(
                action === 'retry'
                  ? 'parseRetry'
                  : action === 'reparse'
                    ? 'parseReparse'
                    : 'parseConfirm',
              )}
            </Button>
          )}
        </footer>
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
      {notice && <p role="status">{t(notice)}</p>}
      {!state.capabilities.readAllowed && <p role="status">{t('parseReadPermission')}</p>}
    </>
  )
}

function Artifact({ state, t }: { state: DocumentParseState; t: ParseTranslate }) {
  const artifact = state.artifact!
  if (artifact.kind !== 'ready')
    return <p>{t(artifact.kind === 'expired' ? 'parseArtifactExpired' : 'parseArtifactMissing')}</p>
  return (
    <section className={css.result}>
      <p>{t('parseArtifactReady')}</p>
      <dl className={css.facts}>
        <dt>{t('parseArtifact')}</dt>
        <dd>{artifact.artifactId}</dd>
        <dt>{t('parseCharacters')}</dt>
        <dd>{artifact.characterCount}</dd>
        <dt>{t('parsePages')}</dt>
        <dd>{artifact.pageCount ?? t('parsePagesUnknown')}</dd>
      </dl>
    </section>
  )
}

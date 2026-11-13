/**
 * The document-enrichment settings form body, shared by the unified settings
 * page's Enrichment tab and the dedicated `dsh-zotero#enrichment` row config.
 *
 * The free/pro switch is a single control over its own staged field; it never
 * reads whether a token is configured, so a configured token does not force
 * pro mode. The token reference, its write-only secret value, and the output
 * directory are independent fields. Enabling the component accepts MinerU
 * document egress; there is no separate upload toggle, and every parse still
 * requires an explicit submission of one document.
 * @module dsh-zotero/client/EnrichmentSettingsForm
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  IconInfoOutlineRegular,
  Modal,
  SegmentedControl,
  SettingsValueField,
  Tag,
  Button,
  type SegmentedControlOption,
  type SettingsFormActions,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ZoteroLocaleKey } from './locales.ts'
import { ENRICHMENT_MODE_CHOICES, ENRICHMENT_DEFAULTS } from '../enrichment-preferences.ts'
import {
  SEMANTIC_DOWNLOAD_SOURCES,
  SEMANTIC_MODEL_KEYS,
  SEMANTIC_MODELS,
  type SemanticModelKey,
} from '../enrichment-model-catalog.ts'
import { BooleanField, ChoiceField, SecretField, type ChoiceOption } from './fields.tsx'
import type { EnrichmentCardState } from './enrichment-form-controller.ts'
import css from './ZoteroSettingsForm.module.css'
import fieldCss from './fields.module.css'
import linkCss from './components/link.module.css'

type T = (key: ZoteroLocaleKey, params?: Record<string, unknown>) => string

/** Fixed mask for a configured token; the stored value never reaches the browser. */
const MASKED_TOKEN = '************'

export type EnrichmentFormActions = Pick<SettingsFormActions, 'edit' | 'resetField'> & {
  downloadModel?: (force?: boolean) => Promise<void>
  cancelModelDownload?: () => Promise<void>
  deleteModel?: () => Promise<void>
  verifyModel?: () => Promise<void>
  checkModelStatus?: () => Promise<void>
}

/** One locale key per model tier; the `satisfies` makes a missing label a build error. */
const SEMANTIC_MODEL_LABEL_KEYS = {
  balanced: 'semanticModelBalanced',
  lightweight: 'semanticModelLightweight',
  bilingual: 'semanticModelBilingual',
  english: 'semanticModelEnglish',
  hybrid: 'semanticModelHybrid',
  academic: 'semanticModelAcademic',
} as const satisfies Record<SemanticModelKey, ZoteroLocaleKey>

const SEMANTIC_MODEL_DESCRIPTION_KEYS = {
  balanced: 'semanticModelBalancedDesc',
  lightweight: 'semanticModelLightweightDesc',
  bilingual: 'semanticModelBilingualDesc',
  english: 'semanticModelEnglishDesc',
  hybrid: 'semanticModelHybridDesc',
  academic: 'semanticModelAcademicDesc',
} as const satisfies Record<SemanticModelKey, ZoteroLocaleKey>

/** One semantic-model action button, derived once from the model state. */
export interface SemanticModelAction {
  readonly id: 'cancel' | 'delete' | 'download' | 'redownload' | 'verify'
  readonly labelKey: ZoteroLocaleKey
  readonly variant: 'primary' | 'ghost'
  readonly disabled: boolean
  readonly onClick: () => void
}

/** Everything the action set reads, so the branch lives in one place. */
export interface SemanticModelActionInput {
  readonly downloading: boolean
  readonly ready: boolean
  readonly failed: boolean
  readonly canDelete: boolean
  readonly disabled: boolean
  readonly checking: boolean
  readonly cancelling: boolean
  readonly deleting: boolean
  readonly actions: EnrichmentFormActions
  readonly confirmDelete: () => void
}

/**
 * The actions one model state offers, in bar order.
 *
 * The sets differ per state — a download in flight offers only cancel, a ready
 * bundle offers verify/redownload/delete, a failed one adds download — and the
 * three branches used to restate every button. A new action or a changed
 * disabled rule now lives here once.
 *
 * Delete is disabled while a verification runs: both operations take the model
 * lock, and letting the user start a delete under a running verify only to see
 * it fail is not a choice worth offering.
 * @param input - the model state and the handlers.
 * @returns the actions, in the order the bar renders them.
 */
export function semanticModelActionsOf(input: SemanticModelActionInput): SemanticModelAction[] {
  const { actions } = input
  if (input.downloading) {
    return [
      {
        id: 'cancel',
        labelKey: 'semanticModelCancelAction',
        variant: 'ghost',
        disabled: input.cancelling || input.deleting,
        onClick: () => actions.cancelModelDownload?.(),
      },
    ]
  }
  const download: SemanticModelAction = {
    id: 'download',
    labelKey: 'semanticModelDownloadAction',
    variant: 'primary',
    disabled: input.disabled || input.deleting,
    onClick: () => actions.downloadModel?.(),
  }
  const redownload: SemanticModelAction = {
    id: 'redownload',
    labelKey: 'semanticModelRedownloadAction',
    variant: 'ghost',
    disabled: input.disabled || input.deleting,
    onClick: () => actions.downloadModel?.(true),
  }
  const verify: SemanticModelAction = {
    id: 'verify',
    labelKey: 'semanticModelVerifyAction',
    variant: 'ghost',
    disabled: input.disabled || input.checking || input.deleting,
    onClick: () => actions.verifyModel?.(),
  }
  const remove: SemanticModelAction = {
    id: 'delete',
    labelKey: 'semanticModelDeleteAction',
    variant: 'ghost',
    disabled: input.disabled || input.checking || input.deleting,
    onClick: input.confirmDelete,
  }
  if (input.ready) {
    return input.canDelete ? [verify, redownload, remove] : [verify, redownload]
  }
  if (input.failed) {
    return input.canDelete ? [download, redownload, verify, remove] : [download, redownload, verify]
  }
  return [download]
}

interface EnrichmentSettingsFormProps {
  t: T
  state: EnrichmentCardState
  actions: EnrichmentFormActions
}

export function EnrichmentSettingsForm({
  t,
  state,
  actions,
}: EnrichmentSettingsFormProps): ReactNode {
  const disabled = !state.writable || state.saving
  const deleting = state.semanticModelPhase === 'deleting'
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { checkModelStatus } = actions
  const downloading = state.semanticModelState?.downloading === true
  const available = state.semanticModelUnavailable === false && state.available === true
  const canDelete =
    state.semanticModelState !== undefined &&
    !downloading &&
    (state.semanticModelState.ready ||
      state.semanticModelState.error !== undefined ||
      state.semanticModelState.downloadedBytes > 0)
  // One derivation for the whole action bar: the three state branches used to
  // restate every button and its disabled rule.
  const modelActions = semanticModelActionsOf({
    downloading,
    ready: state.semanticModelState?.ready === true,
    failed:
      state.semanticModelState?.error !== undefined || state.semanticModelFailure !== undefined,
    canDelete,
    disabled,
    checking: state.semanticModelPhase === 'checking',
    cancelling: state.semanticModelPhase === 'cancelling',
    deleting,
    actions,
    confirmDelete: () => setConfirmDelete(true),
  })
  // Refresh only while a task is active on an available component. A hidden
  // surface starts no work; visibility is re-checked on every tick and on the
  // visibilitychange event. One in-flight read at a time keeps the cadence from
  // overlapping itself, and the controller owns the AbortSignal per operation.
  const inFlight = useRef(false)
  const controllerRef = useRef<AbortController | undefined>(undefined)
  const disposedRef = useRef(false)

  useEffect(() => {
    disposedRef.current = false
    const refresh = (): void => {
      if (disposedRef.current || inFlight.current) return
      if (document.visibilityState !== 'visible') return
      inFlight.current = true
      Promise.resolve(checkModelStatus?.())
        .catch(() => {
          // A late exception after teardown or a hidden surface is dropped; the
          // controller itself also guards on disposed/generation.
        })
        .finally(() => {
          inFlight.current = false
        })
    }
    // One check when the form opens, only when the component is available.
    if (available) refresh()
    if (!downloading || !available) {
      controllerRef.current?.abort()
      controllerRef.current = undefined
      return
    }
    const controller = new AbortController()
    controllerRef.current = controller
    const tick = (): void => {
      if (controller.signal.aborted) return
      refresh()
    }
    const timer = setInterval(tick, 1_500)
    const onVisibility = (): void => {
      if (controller.signal.aborted) return
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposedRef.current = true
      controller.abort()
      if (controllerRef.current === controller) controllerRef.current = undefined
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [checkModelStatus, downloading, available])

  const modeOptions: readonly SegmentedControlOption<string>[] = useMemo(
    () => [
      { value: 'free', label: t('enrichmentModeFree') },
      { value: 'pro', label: t('enrichmentModePro') },
    ],
    [t],
  )
  const modeValue = (ENRICHMENT_MODE_CHOICES as readonly string[]).includes(state.mode.text)
    ? state.mode.text
    : ENRICHMENT_DEFAULTS.mode

  // The option list is the catalog's, with one locale key per tier enforced at
  // compile time: adding a model without labelling it fails the build.
  const modelOptions: readonly ChoiceOption[] = useMemo(
    () =>
      SEMANTIC_MODELS.map((model) => ({
        value: model.key,
        label: t(SEMANTIC_MODEL_LABEL_KEYS[model.key]),
      })),
    [t],
  )
  const modelValue = (SEMANTIC_MODEL_KEYS as readonly string[]).includes(state.semanticModel.text)
    ? state.semanticModel.text
    : ENRICHMENT_DEFAULTS.semanticModel

  const modelDescriptions: Record<string, string> = useMemo(
    () =>
      Object.fromEntries(
        SEMANTIC_MODELS.map((model) => [model.key, t(SEMANTIC_MODEL_DESCRIPTION_KEYS[model.key])]),
      ),
    [t],
  )

  const sourceOptions: readonly ChoiceOption[] = useMemo(
    () => [
      { value: 'hf-mirror', label: t('semanticSourceHfMirror') },
      { value: 'huggingface', label: t('semanticSourceHuggingFace') },
    ],
    [t],
  )
  const sourceValue = (SEMANTIC_DOWNLOAD_SOURCES as readonly string[]).includes(
    state.semanticDownloadSource.text,
  )
    ? state.semanticDownloadSource.text
    : ENRICHMENT_DEFAULTS.semanticDownloadSource

  const isSemanticSearchEnabled = state.enableSemanticSearch.text === 'true'

  return (
    <>
      <section className={css.group} aria-label={t('groupEnrichmentMode')}>
        <div className={css.groupHeader}>
          <h3 className={css.groupHeading}>{t('groupEnrichmentMode')}</h3>
          <p className={css.groupNote}>{t('groupEnrichmentModeDesc')}</p>
        </div>
        <div className={css.fields}>
          <div className={fieldCss.field}>
            {state.mode.overridden && (
              <div className={fieldCss.toggleRow}>
                <span className={fieldCss.badges}>
                  <Tag tone="neutral">{t('overridden')}</Tag>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    onClick={() => actions.resetField('mode')}
                  >
                    {t('reset')}
                  </Button>
                </span>
              </div>
            )}
            <SegmentedControl
              id="enrichment-mode"
              value={modeValue}
              options={modeOptions}
              onChange={(next) => actions.edit('mode', next)}
              label={t('enrichmentMode')}
              disabled={disabled}
            />
            <p className={fieldCss.hint}>{t('enrichmentModeHint')}</p>
          </div>
        </div>
      </section>

      <section className={css.group} aria-label={t('groupEnrichmentAuth')}>
        <div className={css.groupHeader}>
          <h3 className={css.groupHeading}>{t('groupEnrichmentAuth')}</h3>
          <p className={css.groupNote}>{t('groupEnrichmentAuthDesc')}</p>
        </div>
        <div className={css.fields}>
          {modeValue === 'pro' && !state.mineruToken.configured && (
            <div className={fieldCss.warningBox} role="alert">
              <div className={fieldCss.warningHead}>
                <Tag tone="warning">{t('enrichmentTokenMissingTag')}</Tag>
                <span className={fieldCss.warningTitle}>{t('enrichmentTokenMissingTitle')}</span>
              </div>
              <p className={fieldCss.warningText}>{t('enrichmentTokenMissingDesc')}</p>
            </div>
          )}
          <SecretField
            id="enrichment-settings-token"
            label={t('enrichmentToken')}
            hint={
              state.mineruToken.referenceState === 'invalid'
                ? t('invalidCredentialRef')
                : t('enrichmentTokenHint')
            }
            text={state.mineruToken.text}
            configured={state.mineruToken.configured}
            stateLabel={
              state.mineruToken.configured ? t('secretConfigured') : t('secretNotConfigured')
            }
            placeholder={MASKED_TOKEN}
            disabled={state.mineruToken.disabled}
            onEdit={(text) => actions.edit('mineruToken', text)}
            help={
              <p className={fieldCss.tokenHelp}>
                <span className={fieldCss.tokenHelpIcon} aria-hidden="true">
                  <IconInfoOutlineRegular size={12} />
                </span>
                <span>{t('enrichmentTokenWhereToCreate')}</span>
                <a
                  className={linkCss.link}
                  href="https://mineru.net"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('enrichmentTokenVisitMineru')}
                </a>
              </p>
            }
          />
        </div>
      </section>

      <section className={css.group} aria-label={t('groupEnrichmentOutput')}>
        <div className={css.groupHeader}>
          <h3 className={css.groupHeading}>{t('groupEnrichmentOutput')}</h3>
          <p className={css.groupNote}>{t('groupEnrichmentOutputDesc')}</p>
        </div>
        <div className={css.fields}>
          <SettingsValueField
            id="enrichment-settings-output-dir"
            label={t('enrichmentOutputDir')}
            hint={t('enrichmentOutputDirHint')}
            text={state.outputDir.text}
            overridden={state.outputDir.overridden}
            invalid={state.outputDir.invalid}
            overriddenLabel={t('overridden')}
            resetLabel={t('reset')}
            invalidLabel={t('enrichmentOutputDirInvalid')}
            placeholder={t('enrichmentOutputDirDefault')}
            disabled={disabled}
            onEdit={(text) => actions.edit('outputDir', text)}
            onReset={() => actions.resetField('outputDir')}
          />
        </div>
      </section>

      <section className={css.group} aria-label={t('groupSemanticRanking')}>
        <div className={css.groupHeader}>
          <h3 className={css.groupHeading}>{t('groupSemanticRanking')}</h3>
          <p className={css.groupNote}>{t('groupSemanticRankingDesc')}</p>
        </div>
        <div className={css.fields}>
          <BooleanField
            label={t('enableSemanticSearch')}
            hint={t('enableSemanticSearchHint')}
            text={state.enableSemanticSearch.text}
            overridden={state.enableSemanticSearch.overridden}
            overriddenLabel={t('overridden')}
            resetLabel={t('reset')}
            disabled={disabled}
            onEdit={(text) => actions.edit('enableSemanticSearch', text)}
            onReset={() => actions.resetField('enableSemanticSearch')}
          />

          {isSemanticSearchEnabled && !state.semanticModelState?.ready && (
            <div className={fieldCss.warningBox} role="alert">
              <div className={fieldCss.warningHead}>
                <Tag tone="warning">{t('semanticModelNotReadyWarningTag')}</Tag>
                <span className={fieldCss.warningTitle}>
                  {t('semanticModelNotReadyWarningTitle')}
                </span>
              </div>
              <p className={fieldCss.warningText}>
                {state.semanticModelState?.downloading
                  ? t('semanticModelDownloadingNotice')
                  : t('semanticModelNotReadyWarningDesc')}
              </p>
            </div>
          )}

          <ChoiceField
            id="enrichment-semantic-model"
            label={t('semanticModel')}
            hint={modelDescriptions[modelValue] ?? t('semanticModelHint')}
            value={modelValue}
            options={modelOptions}
            overridden={state.semanticModel.overridden}
            disabled={disabled}
            resetLabel={t('reset')}
            overriddenLabel={t('overridden')}
            onSelect={(next) => actions.edit('semanticModel', next)}
            onReset={() => actions.resetField('semanticModel')}
          />

          <ChoiceField
            id="enrichment-download-source"
            label={t('semanticDownloadSource')}
            hint={t('semanticDownloadSourceHint')}
            value={sourceValue}
            options={sourceOptions}
            overridden={state.semanticDownloadSource.overridden}
            disabled={disabled}
            resetLabel={t('reset')}
            overriddenLabel={t('overridden')}
            onSelect={(next) => actions.edit('semanticDownloadSource', next)}
            onReset={() => actions.resetField('semanticDownloadSource')}
          />

          <SettingsValueField
            id="enrichment-settings-semantic-dir"
            label={t('semanticModelDir')}
            hint={t('semanticModelDirHint')}
            text={state.semanticModelDir.text}
            overridden={state.semanticModelDir.overridden}
            invalid={state.semanticModelDir.invalid}
            overriddenLabel={t('overridden')}
            resetLabel={t('reset')}
            invalidLabel={t('enrichmentOutputDirInvalid')}
            placeholder={t('semanticModelDirDefault')}
            disabled={disabled}
            onEdit={(text) => actions.edit('semanticModelDir', text)}
            onReset={() => actions.resetField('semanticModelDir')}
          />

          <div className={fieldCss.field}>
            <div className={fieldCss.toggleRow}>
              <span className={fieldCss.badges}>
                <span className={fieldCss.hint}>
                  <strong>{t('semanticModelStatus')}</strong>
                </span>
                {state.semanticModelPhase === 'deleting' ? (
                  <Tag tone="info">{t('semanticModelStatusDeleting')}</Tag>
                ) : state.semanticModelPhase === 'cancelling' ? (
                  <Tag tone="info">{t('semanticModelStatusCancelling')}</Tag>
                ) : state.semanticModelPhase === 'checking' ? (
                  <Tag tone="info">{t('semanticModelStatusChecking')}</Tag>
                ) : state.semanticModelState?.downloading ? (
                  <Tag tone="info">
                    {t('semanticModelStatusDownloading')} ({state.semanticModelState.percent}%)
                  </Tag>
                ) : state.semanticModelState?.ready ? (
                  <Tag tone="success">{t('semanticModelStatusReady')}</Tag>
                ) : state.semanticModelState?.error || state.semanticModelFailure ? (
                  <Tag tone="danger">{t('semanticModelStatusFailed')}</Tag>
                ) : (
                  <Tag tone="neutral">{t('semanticModelStatusNotDownloaded')}</Tag>
                )}
                {modelActions.map((action) => (
                  <Button
                    key={action.id}
                    variant={action.variant}
                    size="sm"
                    disabled={action.disabled}
                    onClick={action.onClick}
                  >
                    {t(action.labelKey)}
                  </Button>
                ))}
              </span>
            </div>

            {state.semanticModelState?.downloading && (
              <>
                <div
                  className={fieldCss.progressTrack}
                  role="progressbar"
                  aria-valuenow={state.semanticModelState.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className={fieldCss.progressFill}
                    style={{ width: `${state.semanticModelState.percent}%` }}
                  />
                </div>
                <p className={fieldCss.hint}>
                  {state.semanticModelState.downloadedBytes > 0
                    ? (state.semanticModelState.downloadedBytes / 1024 / 1024).toFixed(1)
                    : '0'}{' '}
                  MiB / {(state.semanticModelState.totalBytes / 1024 / 1024).toFixed(1)} MiB (
                  {state.semanticModelState.percent}%)
                  {state.semanticModelState.currentFile
                    ? ` · ${state.semanticModelState.currentFile}`
                    : ''}
                </p>
              </>
            )}

            {isSemanticSearchEnabled &&
              !state.semanticModelState?.ready &&
              !state.semanticModelState?.downloading && (
                <p className={`${fieldCss.hint} ${fieldCss.statusWarning}`}>
                  {t('semanticModelNotDownloadedWarningNotice')}
                </p>
              )}

            {state.semanticModelState?.ready && (
              <p className={fieldCss.hint}>{t('semanticModelDownloadedNotice')}</p>
            )}

            {state.semanticModelState?.warning && (
              <p className={fieldCss.hint}>
                {t('semanticModelCleanupWarning', { detail: state.semanticModelState.warning })}
              </p>
            )}

            {state.semanticModelUnavailable && (
              <p className={fieldCss.hint}>{t('semanticModelUnavailable')}</p>
            )}

            {state.semanticModelFailure && !state.semanticModelUnavailable && (
              <p className={`${fieldCss.hint} ${fieldCss.statusError}`}>
                {state.semanticModelFailure.message} ({state.semanticModelFailure.code})
              </p>
            )}

            {state.semanticModelState?.error && (
              <p className={`${fieldCss.hint} ${fieldCss.statusError}`}>
                {state.semanticModelState.error}
              </p>
            )}

            {!state.semanticModelUnavailable &&
              !state.semanticModelState?.ready &&
              !state.semanticModelState?.downloading &&
              (state.semanticModelState?.error || state.semanticModelFailure) && (
                <p className={fieldCss.hint}>{t('semanticModelBundleRepairHint')}</p>
              )}
          </div>
        </div>
        <Modal
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title={t('semanticModelDeleteTitle')}
          description={t('semanticModelDeleteDescription')}
          closeLabel={t('semanticModelDeleteClose')}
          footer={
            <>
              <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                {t('semanticModelDeleteCancel')}
              </Button>
              <Button
                variant="primary"
                disabled={disabled || deleting}
                onClick={() => {
                  setConfirmDelete(false)
                  void actions.deleteModel?.()
                }}
              >
                {t('semanticModelDeleteConfirm')}
              </Button>
            </>
          }
        />
      </section>
    </>
  )
}

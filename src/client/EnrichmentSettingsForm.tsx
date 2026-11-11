/**
 * The document-enrichment settings form body, shared by the unified settings
 * page's Enrichment tab and the dedicated `dsh-zotero#enrichment` row config.
 *
 * The free/pro switch is a single control over its own staged field; it never
 * reads whether a token is configured, so a configured token does not force
 * pro mode. The token reference, its secret value, the data-egress switch, and
 * the output directory are independent fields.
 * @module dsh-zotero/client/EnrichmentSettingsForm
 */

import { useEffect, useMemo, type ReactNode } from 'react'
import {
  SegmentedControl,
  SettingsSecretField,
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
import { BooleanField, ChoiceField, type ChoiceOption } from './fields.tsx'
import type { EnrichmentCardState } from './enrichment-form-controller.ts'
import css from './ZoteroSettingsForm.module.css'
import fieldCss from './fields.module.css'
import linkCss from './components/link.module.css'

type T = (key: ZoteroLocaleKey) => string
type EnrichmentFormActions = Pick<SettingsFormActions, 'edit' | 'resetField'> & {
  downloadModel?: (force?: boolean) => Promise<void>
  cancelModelDownload?: () => Promise<void>
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
  const { checkModelStatus } = actions
  const downloading = state.semanticModelState?.downloading === true

  // The model status belongs to this surface, not to the client fiber: one
  // check when the form opens, and a 1.5 s cadence only while a download is
  // in flight, cleaned up when it ends or the form unmounts.
  useEffect(() => {
    void checkModelStatus?.()
  }, [checkModelStatus])

  useEffect(() => {
    if (!downloading) return
    const timer = setInterval(() => {
      void checkModelStatus?.()
    }, 1_500)
    return () => {
      clearInterval(timer)
    }
  }, [downloading, checkModelStatus])

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
              <div className={fieldCss.toggleRow}>
                <a
                  className={linkCss.link}
                  href="https://mineru.net"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('enrichmentTokenVisitMineru')}
                </a>
              </div>
            </div>
          )}
          <SettingsSecretField
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
            disabled={state.mineruToken.disabled}
            onEdit={(text) => actions.edit('mineruToken', text)}
          />

          <BooleanField
            label={t('allowDocumentUpload')}
            hint={t('allowDocumentUploadHint')}
            text={state.allowDocumentUpload.text}
            overridden={state.allowDocumentUpload.overridden}
            overriddenLabel={t('overridden')}
            resetLabel={t('reset')}
            disabled={disabled}
            onEdit={(text) => actions.edit('allowDocumentUpload', text)}
            onReset={() => actions.resetField('allowDocumentUpload')}
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
                {state.semanticModelState?.downloading ? (
                  <Tag tone="info">
                    {t('semanticModelStatusDownloading')} ({state.semanticModelState.percent}%)
                  </Tag>
                ) : state.semanticModelState?.ready ? (
                  <Tag tone="success">{t('semanticModelStatusReady')}</Tag>
                ) : state.semanticModelState?.error ? (
                  <Tag tone="danger">{t('semanticModelStatusFailed')}</Tag>
                ) : (
                  <Tag tone="neutral">{t('semanticModelStatusNotDownloaded')}</Tag>
                )}
                {state.semanticModelState?.downloading ? (
                  <Button variant="ghost" size="sm" onClick={() => actions.cancelModelDownload?.()}>
                    {t('semanticModelCancelAction')}
                  </Button>
                ) : state.semanticModelState?.ready ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => actions.verifyModel?.()}
                    >
                      {t('semanticModelVerifyAction')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => actions.downloadModel?.(true)}
                    >
                      {t('semanticModelRedownloadAction')}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={disabled}
                    onClick={() => actions.downloadModel?.()}
                  >
                    {t('semanticModelDownloadAction')}
                  </Button>
                )}
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

            {state.semanticModelUnavailable && (
              <p className={fieldCss.hint}>{t('semanticModelUnavailable')}</p>
            )}

            {state.semanticModelState?.error && (
              <p className={`${fieldCss.hint} ${fieldCss.statusError}`}>
                {state.semanticModelState.error}
              </p>
            )}
          </div>
        </div>
      </section>
    </>
  )
}

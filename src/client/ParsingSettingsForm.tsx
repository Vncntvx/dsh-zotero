/**
 * The document-parsing settings form body, shared by the unified settings
 * page's Parsing tab and the dedicated `dsh-zotero#parsing` row config.
 *
 * The free/pro switch is a single control over its own staged field; it never
 * reads whether a token is configured, so a configured token does not force
 * pro mode. The token reference, its secret value, the data-egress switch, and
 * the output directory are independent fields.
 * @module dsh-zotero/client/ParsingSettingsForm
 */

import { useMemo, type ReactNode } from 'react'
import {
  SegmentedControl,
  SettingsSecretField,
  SettingsValueField,
  Tag,
  Button,
  type SegmentedControlOption,
  type SettingsFormActions,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { BooleanField } from './fields.tsx'
import type { ZoteroLocaleKey } from './locales.ts'
import { PARSING_MODE_CHOICES, PARSING_DEFAULTS } from '../parsing-preferences.ts'
import { PARSING_SUGGESTED_REF, type ParsingCardState } from './parsing-form-controller.ts'
import css from './ZoteroSettingsForm.module.css'
import fieldCss from './fields.module.css'

type T = (key: ZoteroLocaleKey) => string
type ParsingFormActions = Pick<SettingsFormActions, 'edit' | 'resetField'>

interface ParsingSettingsFormProps {
  t: T
  state: ParsingCardState
  actions: ParsingFormActions
}

export function ParsingSettingsForm({ t, state, actions }: ParsingSettingsFormProps): ReactNode {
  const disabled = !state.writable || state.saving

  const modeOptions: readonly SegmentedControlOption<string>[] = useMemo(
    () => [
      { value: 'free', label: t('parsingModeFree') },
      { value: 'pro', label: t('parsingModePro') },
    ],
    [t],
  )
  const modeValue = (PARSING_MODE_CHOICES as readonly string[]).includes(state.mode.text)
    ? state.mode.text
    : PARSING_DEFAULTS.mode

  return (
    <>
      <section className={css.group} aria-label={t('groupParsingMode')}>
        <div className={css.groupHeader}>
          <h3 className={css.groupHeading}>{t('groupParsingMode')}</h3>
          <p className={css.groupNote}>{t('groupParsingModeDesc')}</p>
        </div>
        <div className={css.fields}>
          <div className={fieldCss.field}>
            <div className={fieldCss.toggleRow}>
              <span>{t('parsingMode')}</span>
              {state.mode.overridden && (
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
              )}
            </div>
            <SegmentedControl
              id="parsing-mode"
              value={modeValue}
              options={modeOptions}
              onChange={(next) => actions.edit('mode', next)}
              label={t('parsingMode')}
              disabled={disabled}
            />
            <p className={fieldCss.hint}>{t('parsingModeHint')}</p>
          </div>
        </div>
      </section>

      <section className={css.group} aria-label={t('groupParsingAuth')}>
        <div className={css.groupHeader}>
          <h3 className={css.groupHeading}>{t('groupParsingAuth')}</h3>
          <p className={css.groupNote}>{t('groupParsingAuthDesc')}</p>
        </div>
        <div className={css.fields}>
          <SettingsValueField
            id="parsing-settings-token-ref"
            label={t('parsingTokenRef')}
            hint={t('parsingTokenRefHint').replace('{suggested}', PARSING_SUGGESTED_REF)}
            text={state.mineruTokenRef.text}
            overridden={state.mineruTokenRef.overridden}
            invalid={state.mineruTokenRef.invalid}
            overriddenLabel={t('overridden')}
            resetLabel={t('reset')}
            invalidLabel={t('invalidCredentialRef')}
            disabled={disabled}
            onEdit={(text) => actions.edit('mineruTokenRef', text)}
            onReset={() => actions.resetField('mineruTokenRef')}
          />
          <SettingsSecretField
            id="parsing-settings-token"
            label={t('parsingToken')}
            hint={
              state.mineruToken.referenceState === 'missing'
                ? t('parsingTokenNeedsReference')
                : t('parsingTokenHint')
            }
            text={state.mineruToken.text}
            configured={state.mineruToken.configured}
            stateLabel={
              state.mineruToken.configured ? t('secretConfigured') : t('secretNotConfigured')
            }
            disabled={state.mineruToken.disabled}
            onEdit={(text) => actions.edit('mineruToken', text)}
          />
        </div>
      </section>

      <section className={css.group} aria-label={t('groupParsingOutput')}>
        <div className={css.groupHeader}>
          <h3 className={css.groupHeading}>{t('groupParsingOutput')}</h3>
          <p className={css.groupNote}>{t('groupParsingOutputDesc')}</p>
        </div>
        <div className={css.fields}>
          <SettingsValueField
            id="parsing-settings-output-dir"
            label={t('parsingOutputDir')}
            hint={t('parsingOutputDirHint')}
            text={state.outputDir.text}
            overridden={state.outputDir.overridden}
            invalid={state.outputDir.invalid}
            overriddenLabel={t('overridden')}
            resetLabel={t('reset')}
            invalidLabel={t('parsingOutputDirInvalid')}
            placeholder={t('parsingOutputDirDefault')}
            disabled={disabled}
            onEdit={(text) => actions.edit('outputDir', text)}
            onReset={() => actions.resetField('outputDir')}
          />
          <BooleanField
            label={t('parsingAllowUpload')}
            hint={t('parsingAllowUploadHint')}
            text={state.allowParsingUpload.text || String(PARSING_DEFAULTS.allowParsingUpload)}
            overridden={state.allowParsingUpload.overridden}
            overriddenLabel={t('overridden')}
            resetLabel={t('reset')}
            disabled={disabled}
            onEdit={(text) => actions.edit('allowParsingUpload', text)}
            onReset={() => actions.resetField('allowParsingUpload')}
            risk={{
              title: t('parsingUploadRiskTitle'),
              description: t('parsingUploadRiskDescription'),
              acknowledgeLabel: t('parsingUploadRiskAcknowledge'),
              confirmLabel: t('parsingUploadRiskConfirm'),
              cancelLabel: t('writeRiskCancel'),
              closeLabel: t('writeRiskClose'),
            }}
          />
        </div>
      </section>
    </>
  )
}

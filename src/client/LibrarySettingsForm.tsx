/** Complete, staged settings shared by the bundle and component pages. */
import { useState, type ReactNode } from 'react'
import {
  Button,
  Checkbox,
  IconInfoOutlineRegular,
  Tag,
  type SettingsFormActions,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  LIBRARY_CHOICES,
  LIBRARY_DEFAULTS,
  LIBRARY_SECTIONS,
  type LibraryPreferenceKey,
  type LibraryPreferences,
} from '../library-preferences.ts'
import type { ZoteroLocaleKey } from './locales.ts'
import type { ZoteroJournalMetricsRefreshView } from '../contract.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { BooleanField, ChoiceField as ChoiceFieldBase, SecretField } from './fields.tsx'
import { JOURNAL_METRIC_DETAIL_FIELDS, journalMetricDetailFieldsOf } from '../journal-metrics.ts'
import { JournalMetricListSettings } from './JournalMetricListSettings.tsx'
import { journalMetricFailureLabels, journalMetricLabel } from './journal-metric-labels.ts'
import type { LibraryCardFace, LibraryCardState } from './library-form-controller.ts'
import linkCss from './components/link.module.css'
import noticeCss from './components/notice.module.css'
import css from './ZoteroSettingsForm.module.css'
import fieldCss from './fields.module.css'
import libraryCss from './library-settings.module.css'

type LibraryFormActions = Pick<SettingsFormActions, 'edit' | 'resetField'> &
  Pick<LibraryCardFace, 'refreshJournalMetrics'>
type T = TranslateNS<'zotero'>
const LIBRARY_CHOICE_LABELS: Record<string, ZoteroLocaleKey> = {
  comfortable: 'libraryComfortable',
  compact: 'libraryCompact',
  '1': 'libraryOneLine',
  '2': 'libraryTwoLines',
  sidebar: 'librarySidebarTarget',
  float: 'libraryFloatTarget',
  zotero: 'libraryZoteroTarget',
  restore: 'libraryRestorePosition',
  allItems: 'libraryAllItemsStart',
  preserve: 'libraryPreserveConditions',
  clear: 'libraryClearConditions',
  reference: 'libraryReferenceContent',
  referenceAndAbstract: 'libraryAbstractContent',
  citation: 'libraryCopyCitation',
  bibliography: 'libraryCopyBibliography',
  bibtex: 'libraryCopyBibtex',
  biblatex: 'libraryCopyBiblatex',
  ris: 'libraryCopyRis',
  csljson: 'libraryCopyCsljson',
  csv: 'libraryCopyCsv',
  itemInfo: 'libraryCopyItemInfo',
}
const SECTION_LABELS = {
  abstract: 'libraryMetaAbstract',
  attachments: 'librarySectionAttachments',
  notes: 'librarySectionNotes',
  annotations: 'librarySectionAnnotations',
} as const
const FIELD_LABELS = {
  listDensity: 'libraryListDensity',
  titleLines: 'libraryTitleLines',
  localPdfOpenTarget: 'libraryLocalPdfTarget',
  urlPdfOpenTarget: 'libraryUrlPdfTarget',
  reopenBehavior: 'libraryReopen',
  scopeChangeBehavior: 'libraryScopeChange',
  defaultCopyFormat: 'libraryCopyDefault',
  chatInsertContent: 'libraryChatContent',
} as const

function draftValue<K extends LibraryPreferenceKey>(
  state: LibraryCardState,
  key: K,
): LibraryPreferences[K] | undefined {
  if (state[key].invalid) return undefined
  const text = state[key].text
  return (text === '' ? LIBRARY_DEFAULTS[key] : JSON.parse(text)) as LibraryPreferences[K]
}
function ChoiceField({
  field,
  state,
  actions,
  t,
  disabled,
}: {
  field: keyof typeof LIBRARY_CHOICES
  state: LibraryCardState
  actions: LibraryFormActions
  t: T
  disabled: boolean
}) {
  const label = t(FIELD_LABELS[field])
  const value = draftValue(state, field)
  // An invalid draft is staged text the closed set cannot render; the shared
  // control prints the value it is given, so hand it the localized fallback.
  const staged =
    state[field].invalid || value === undefined ? t('libraryInvalidDraft') : String(value)
  return (
    <ChoiceFieldBase
      id={`library-choice-${field}`}
      label={label}
      hint={t(FIELD_HINTS[field])}
      value={staged}
      options={LIBRARY_CHOICES[field].map((option) => ({
        value: String(option),
        label: t(LIBRARY_CHOICE_LABELS[String(option)]!),
      }))}
      overridden={state[field].overridden}
      invalid={state[field].invalid}
      disabled={disabled}
      overriddenLabel={t('overridden')}
      resetLabel={t('reset')}
      onSelect={(next) => {
        const option = LIBRARY_CHOICES[field].find((entry) => String(entry) === next)
        actions.edit(field, JSON.stringify(option))
      }}
      onReset={() => actions.resetField(field)}
    />
  )
}
const FIELD_HINTS = {
  listDensity: 'libraryDensityHint',
  titleLines: 'libraryTitleLinesHint',
  localPdfOpenTarget: 'libraryLocalPdfHint',
  urlPdfOpenTarget: 'libraryUrlPdfTargetHint',
  reopenBehavior: 'libraryReopenHint',
  scopeChangeBehavior: 'libraryScopeChangeHint',
  defaultCopyFormat: 'libraryCopyDefaultHint',
  chatInsertContent: 'libraryChatContentHint',
} as const
const GROUP_DESCRIPTIONS = {
  libraryDisplaySettings: 'libraryDisplaySettingsHint',
  libraryBrowseSettings: 'libraryBrowseSettingsHint',
  libraryPdfSettings: 'libraryPdfSettingsHint',
  libraryActionSettings: 'libraryActionSettingsHint',
  journalMetrics: 'journalMetricsHint',
} as const

interface LibrarySettingsFormProps {
  t: T
  state: LibraryCardState
  actions: LibraryFormActions
}
export function LibrarySettingsForm({ t, state, actions }: LibrarySettingsFormProps): ReactNode {
  const disabled = !state.writable || state.saving
  const [refreshStatus, setRefreshStatus] = useState<
    ZoteroJournalMetricsRefreshView | 'pending' | 'failed'
  >()
  const refreshing = refreshStatus === 'pending'
  const refresh = async () => {
    if (!actions.refreshJournalMetrics) return
    setRefreshStatus('pending')
    try {
      setRefreshStatus(await actions.refreshJournalMetrics())
    } catch {
      setRefreshStatus('failed')
    }
  }
  const summary = refreshStatus && typeof refreshStatus === 'object' ? refreshStatus : undefined
  const refreshMessage =
    summary?.status === 'finished'
      ? summary.total === 0
        ? t('journalMetricsRefreshEmpty')
        : t('journalMetricsRefreshDone', { refreshed: summary.refreshed, total: summary.total })
      : refreshStatus === 'pending'
        ? t('journalMetricsRefreshing')
        : refreshStatus === 'failed'
          ? t('journalMetricsRefreshFailed')
          : summary?.status === 'disabled'
            ? t('journalMetricsRefreshDisabled')
            : summary?.status === 'credential'
              ? t('journalMetricsCredential')
              : summary?.status === 'running'
                ? t('journalMetricsRefreshRunning')
                : t('journalMetricsRefreshHint')
  const refreshIssue = summary?.status === 'finished' ? summary.failure : undefined
  const choice = (field: keyof typeof LIBRARY_CHOICES) => (
    <ChoiceField
      key={field}
      field={field}
      state={state}
      actions={actions}
      t={t}
      disabled={disabled}
    />
  )
  const sections = draftValue(state, 'detailExpandedSections')
  const metricRules =
    draftValue(state, 'journalMetricListOrder') ?? LIBRARY_DEFAULTS.journalMetricListOrder
  const detailFields =
    draftValue(state, 'journalMetricDetailFields') ?? LIBRARY_DEFAULTS.journalMetricDetailFields
  const boolean = (field: 'rightSidebarEnabled' | 'allowUrlPdfRead') => (
    <BooleanField
      label={t(field === 'rightSidebarEnabled' ? 'rightSidebarEnabled' : 'libraryAllowUrlPdf')}
      hint={t(field === 'rightSidebarEnabled' ? 'rightSidebarHint' : 'libraryAllowUrlPdfHint')}
      text={state[field].text || String(LIBRARY_DEFAULTS[field])}
      overridden={state[field].overridden}
      overriddenLabel={t('overridden')}
      resetLabel={t('reset')}
      disabled={disabled}
      onEdit={(text) => actions.edit(field, text)}
      onReset={() => actions.resetField(field)}
      risk={
        field === 'allowUrlPdfRead'
          ? {
              title: t('libraryUrlRiskTitle'),
              description: t('libraryUrlRiskDescription'),
              acknowledgeLabel: t('libraryUrlRiskAcknowledge'),
              confirmLabel: t('libraryUrlRiskConfirm'),
              cancelLabel: t('writeRiskCancel'),
              closeLabel: t('writeRiskClose'),
            }
          : undefined
      }
    />
  )
  const group = (label: keyof typeof GROUP_DESCRIPTIONS, content: ReactNode) => (
    <section className={css.group} aria-label={t(label)}>
      <div className={css.groupHeader}>
        <h3 className={css.groupHeading}>{t(label)}</h3>
        <p className={css.groupNote}>{t(GROUP_DESCRIPTIONS[label])}</p>
      </div>
      <div className={css.fields}>{content}</div>
    </section>
  )
  // Only rendered while a draft is invalid: an always-mounted slot here would
  // reserve a row ahead of the first group and defeat its :first-child reset.
  return (
    <>
      {state.invalid && (
        <p role="alert" className={`${noticeCss.notice} ${noticeCss.noticeError}`}>
          {t('libraryInvalidDraft')}
        </p>
      )}
      {group(
        'libraryDisplaySettings',
        <>
          {boolean('rightSidebarEnabled')}
          {choice('listDensity')}
          {choice('titleLines')}
          <div className={fieldCss.field} role="group" aria-label={t('libraryExpandedSections')}>
            <div className={fieldCss.fieldHead}>
              <span className={fieldCss.fieldLabel}>{t('libraryExpandedSections')}</span>
              {state.detailExpandedSections.overridden && (
                <span className={fieldCss.badges}>
                  <Tag tone="neutral">{t('overridden')}</Tag>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    aria-label={`${t('reset')}: ${t('libraryExpandedSections')}`}
                    onClick={() => actions.resetField('detailExpandedSections')}
                  >
                    {t('reset')}
                  </Button>
                </span>
              )}
            </div>
            <div className={libraryCss.sectionChoices}>
              {LIBRARY_SECTIONS.map((section) => (
                <Checkbox
                  key={section}
                  checked={sections?.includes(section) ?? false}
                  label={t(SECTION_LABELS[section])}
                  disabled={disabled || !sections}
                  onChange={(checked) =>
                    actions.edit(
                      'detailExpandedSections',
                      JSON.stringify(
                        LIBRARY_SECTIONS.filter((v) =>
                          v === section ? checked : (sections?.includes(v) ?? false),
                        ),
                      ),
                    )
                  }
                />
              ))}
            </div>
            <p className={css.groupNote}>{t('libraryExpandedHint')}</p>
          </div>
        </>,
      )}
      {group(
        'libraryBrowseSettings',
        <>
          {choice('reopenBehavior')}
          {choice('scopeChangeBehavior')}
        </>,
      )}
      {group(
        'libraryPdfSettings',
        <>
          {choice('localPdfOpenTarget')}
          {choice('urlPdfOpenTarget')}
          {boolean('allowUrlPdfRead')}
        </>,
      )}
      {group(
        'libraryActionSettings',
        <>
          {choice('defaultCopyFormat')}
          {choice('chatInsertContent')}
        </>,
      )}
      {group(
        'journalMetrics',
        <>
          <BooleanField
            label={t('journalMetricsEnable')}
            hint={t('journalMetricsEnableHint')}
            text={state.journalMetricsEnabled.text || 'false'}
            overridden={state.journalMetricsEnabled.overridden}
            overriddenLabel={t('overridden')}
            resetLabel={t('reset')}
            disabled={disabled}
            onEdit={(text) => actions.edit('journalMetricsEnabled', text)}
            onReset={() => actions.resetField('journalMetricsEnabled')}
            risk={{
              title: t('journalMetricsRiskTitle'),
              description: t('journalMetricsDisclosure'),
              acknowledgeLabel: t('journalMetricsAcknowledge'),
              confirmLabel: t('journalMetricsAllow'),
              cancelLabel: t('writeRiskCancel'),
              closeLabel: t('writeRiskClose'),
            }}
          />
          <SecretField
            id="library-easyscholar-secret"
            label={t('journalMetricsSecret')}
            hint={t('journalMetricsSecretHint')}
            text={state.easyScholarSecret.text}
            configured={state.easyScholarSecret.configured}
            stateLabel={t(
              state.easyScholarSecret.configured ? 'secretConfigured' : 'secretNotConfigured',
            )}
            disabled={disabled || !state.easyScholarSecret.writable}
            onEdit={(text) => actions.edit('easyScholarSecret', text)}
            help={
              <p className={fieldCss.tokenHelp}>
                <span className={fieldCss.tokenHelpIcon} aria-hidden="true">
                  <IconInfoOutlineRegular size={12} />
                </span>
                <span>{t('journalMetricsSecretWhereToGet')}</span>
                <a
                  className={linkCss.link}
                  href="https://www.easyscholar.cc/console/user/open"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('journalMetricsSecretOpenSite')}
                </a>
              </p>
            }
          />
          <div className={fieldCss.field} role="group" aria-label={t('journalMetricsListFields')}>
            <div className={fieldCss.fieldHead}>
              <span className={fieldCss.fieldLabel}>{t('journalMetricsListFields')}</span>
              {state.journalMetricListOrder.overridden && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  aria-label={`${t('reset')}: ${t('journalMetricsListFields')}`}
                  onClick={() => actions.resetField('journalMetricListOrder')}
                >
                  {t('reset')}
                </Button>
              )}
            </div>
            <JournalMetricListSettings
              t={t}
              rules={metricRules}
              disabled={disabled}
              onChange={(rules) => actions.edit('journalMetricListOrder', JSON.stringify(rules))}
            />
          </div>
          <div className={fieldCss.field}>
            <div className={fieldCss.fieldHead}>
              <span className={fieldCss.fieldLabel}>{t('journalMetricsDetailFields')}</span>
              {state.journalMetricDetailFields.overridden && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  aria-label={`${t('reset')}: ${t('journalMetricsDetailFields')}`}
                  onClick={() => actions.resetField('journalMetricDetailFields')}
                >
                  {t('reset')}
                </Button>
              )}
            </div>
            <div
              role="group"
              aria-label={t('journalMetricsDetailFields')}
              className={libraryCss.metricChoices}
            >
              {JOURNAL_METRIC_DETAIL_FIELDS.map((field) => (
                <Checkbox
                  key={field}
                  checked={detailFields.includes(field)}
                  label={
                    field === 'custom' ? t('journalMetricsCustom') : journalMetricLabel(field, t)
                  }
                  disabled={disabled}
                  onChange={(checked) =>
                    actions.edit(
                      'journalMetricDetailFields',
                      JSON.stringify(
                        journalMetricDetailFieldsOf(
                          checked
                            ? [...detailFields, field]
                            : detailFields.filter((item) => item !== field),
                        ),
                      ),
                    )
                  }
                />
              ))}
            </div>
            <p className={fieldCss.hint}>{t('journalMetricsDetailFieldsHint')}</p>
          </div>
          {actions.refreshJournalMetrics && (
            <div className={fieldCss.field}>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled || refreshing}
                  onClick={refresh}
                >
                  {t('journalMetricsRefresh')}
                </Button>
              </div>
              <p className={fieldCss.hint} role={refreshStatus ? 'status' : undefined}>
                {refreshMessage}
                {refreshIssue && (
                  <>
                    {' '}
                    {t(journalMetricFailureLabels[refreshIssue])}{' '}
                    {t('journalMetricsRefreshIncomplete')}
                  </>
                )}
              </p>
            </div>
          )}
        </>,
      )}
    </>
  )
}

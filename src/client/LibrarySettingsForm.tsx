/** Complete, staged settings shared by the bundle and component pages. */
import { useState, type ReactNode } from 'react'
import {
  Button,
  Checkbox,
  Menu,
  MenuItemButton,
  Tag,
  IconChevronDownOutlineRegular,
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
import { BooleanField } from './fields.tsx'
import type { LibraryCardState } from './library-form-controller.ts'
import css from './ZoteroSettingsForm.module.css'
import fieldCss from './fields.module.css'
import libraryCss from './library-settings.module.css'

type LibraryFormActions = Pick<SettingsFormActions, 'edit' | 'resetField'>
type T = (key: ZoteroLocaleKey) => string
export const LIBRARY_CHOICE_LABELS: Record<string, ZoteroLocaleKey> = {
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
  const [open, setOpen] = useState(false)
  const label = t(FIELD_LABELS[field])
  const value = draftValue(state, field)
  return (
    <div className={fieldCss.field}>
      <div className={libraryCss.fieldHead}>
        <span className={libraryCss.fieldLabel}>{label}</span>
        {state[field].overridden && (
          <span className={fieldCss.badges}>
            <Tag tone="neutral">{t('overridden')}</Tag>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              aria-label={`${t('reset')}: ${label}`}
              onClick={() => actions.resetField(field)}
            >
              {t('reset')}
            </Button>
          </span>
        )}
      </div>
      <Menu
        open={open && !disabled}
        onClose={() => setOpen(false)}
        className={libraryCss.choiceMenu}
        portal
        autoFocus
        minWidthFromAnchor
        anchor={
          <Button
            variant="outline"
            size="md"
            className={libraryCss.choiceControl}
            disabled={disabled}
            onClick={() => setOpen((v) => !v)}
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={open && !disabled}
            aria-invalid={state[field].invalid}
          >
            <span>{t(LIBRARY_CHOICE_LABELS[String(value)] ?? 'libraryInvalidDraft')}</span>
            <IconChevronDownOutlineRegular />
          </Button>
        }
      >
        {LIBRARY_CHOICES[field].map((option) => (
          <MenuItemButton
            key={String(option)}
            current={option === value}
            onSelect={() => {
              actions.edit(field, JSON.stringify(option))
              setOpen(false)
            }}
          >
            {t(LIBRARY_CHOICE_LABELS[String(option)]!)}
          </MenuItemButton>
        ))}
      </Menu>
      <p className={fieldCss.hint}>{t(FIELD_HINTS[field])}</p>
    </div>
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
} as const

export interface LibrarySettingsFormProps {
  t: T
  state: LibraryCardState
  actions: LibraryFormActions
}
export function LibrarySettingsForm({ t, state, actions }: LibrarySettingsFormProps): ReactNode {
  const disabled = !state.writable || state.saving
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
  return (
    <>
      <p className={css.groupNote}>{t('librarySharedSettingsHint')}</p>
      {state.invalid && <p role="alert">{t('libraryInvalidDraft')}</p>}
      {group(
        'libraryDisplaySettings',
        <>
          {boolean('rightSidebarEnabled')}
          {choice('listDensity')}
          {choice('titleLines')}
          <div className={fieldCss.field} role="group" aria-label={t('libraryExpandedSections')}>
            <div className={libraryCss.fieldHead}>
              <span className={libraryCss.fieldLabel}>{t('libraryExpandedSections')}</span>
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
    </>
  )
}

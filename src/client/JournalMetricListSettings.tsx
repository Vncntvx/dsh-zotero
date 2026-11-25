import { useRef, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Button,
  IconChevronDownOutlineRegular,
  IconChevronUpOutlineRegular,
  IconCloseOutlineRegular,
  Menu,
  MenuItemButton,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  JOURNAL_METRIC_LIST_CANDIDATES,
  JOURNAL_METRIC_LIST_LIMITS,
  JOURNAL_METRIC_LIST_PROFILES,
  journalMetricListValues,
  type JournalMetricListProfile,
  type JournalMetricListRules,
} from '../journal-metrics.ts'
import { IconButton } from './components/IconButton.tsx'
import { ChoiceField } from './fields.tsx'
import { journalMetricLabel, journalMetricSummaryLabel } from './journal-metric-labels.ts'
import fieldCss from './fields.module.css'
import css from './library-settings.module.css'

type T = TranslateNS<'zotero'>
const PROFILE_LABELS = {
  international: 'journalMetricsInternational',
  chineseCore: 'journalMetricsChineseCore',
} as const
const PREVIEW = {
  international: [
    { field: 'sci', value: 'Q1' },
    { field: 'sciif', value: '4.0' },
    { field: 'sciUp', value: '2' },
    { field: 'ccf', value: 'B' },
  ],
  chineseCore: [
    { field: 'cssci', value: '✓' },
    { field: 'cscd', value: '✓' },
    { field: 'pku', value: '✓' },
    { field: 'zhongguokejihexin', value: '✓' },
  ],
} as const

function Preset({
  t,
  profile,
  rules,
  disabled,
  onChange,
}: {
  t: T
  profile: JournalMetricListProfile
  rules: JournalMetricListRules
  disabled: boolean
  onChange: (rules: JournalMetricListRules) => void
}) {
  const [open, setOpen] = useState(false)
  const addButton = useRef<HTMLButtonElement>(null)
  const candidates = rules[profile]
  const available = JOURNAL_METRIC_LIST_CANDIDATES.filter((field) => !candidates.includes(field))
  const label = t(PROFILE_LABELS[profile])
  const labelOf = (field: string) =>
    field === 'jcr' ? t('journalMetricsJcrFallback') : journalMetricLabel(field, t)
  const saveCandidates = (next: JournalMetricListRules[JournalMetricListProfile]) =>
    onChange({ ...rules, [profile]: next })
  const move = (index: number, target: number) => {
    const next = [...candidates]
    const [field] = next.splice(index, 1)
    next.splice(target, 0, field!)
    saveCandidates(next)
  }
  const preview = journalMetricListValues(PREVIEW[profile], rules, false)
    .map(({ field, value }) => `${journalMetricSummaryLabel(field, t)} ${value}`)
    .join(' · ')

  return (
    <section className={css.metricPreset} aria-label={label}>
      <h4 className={fieldCss.fieldLabel}>{label}</h4>
      <ol className={css.metricCandidates}>
        {candidates.map((field, index) => {
          const metric = labelOf(field)
          return (
            <li key={field} className={css.metricCandidate}>
              <span>{metric}</span>
              <div className={css.metricCandidateActions}>
                <IconButton
                  size="sm"
                  icon={<IconChevronUpOutlineRegular />}
                  aria-label={t('journalMetricsMoveUp', { metric })}
                  disabled={disabled || index === 0}
                  onClick={() => move(index, index - 1)}
                />
                <IconButton
                  size="sm"
                  icon={<IconChevronDownOutlineRegular />}
                  aria-label={t('journalMetricsMoveDown', { metric })}
                  disabled={disabled || index === candidates.length - 1}
                  onClick={() => move(index, index + 1)}
                />
                <IconButton
                  size="sm"
                  icon={<IconCloseOutlineRegular />}
                  aria-label={t('journalMetricsRemoveCandidate', { metric })}
                  disabled={disabled}
                  onClick={() => {
                    saveCandidates(candidates.filter((candidate) => candidate !== field))
                    addButton.current?.focus()
                  }}
                />
              </div>
            </li>
          )
        })}
      </ol>
      <div>
        <Menu
          open={open && !disabled}
          onClose={() => setOpen(false)}
          portal
          autoFocus
          minWidthFromAnchor
          anchor={
            <Button
              ref={addButton}
              size="sm"
              variant="outline"
              aria-haspopup="menu"
              aria-expanded={open && !disabled}
              disabled={disabled || !available.length}
              onClick={() => setOpen((current) => !current)}
            >
              {t('journalMetricsAddCandidate')}
            </Button>
          }
        >
          {available.map((field) => (
            <MenuItemButton
              key={field}
              onSelect={() => {
                saveCandidates([...candidates, field])
                setOpen(false)
              }}
            >
              {labelOf(field)}
            </MenuItemButton>
          ))}
        </Menu>
      </div>
      <p className={fieldCss.hint}>
        {t('journalMetricsListPreview', { metrics: preview || t('journalMetricsPreviewEmpty') })}
      </p>
    </section>
  )
}

export function JournalMetricListSettings({
  t,
  rules,
  disabled,
  onChange,
}: {
  t: T
  rules: JournalMetricListRules
  disabled: boolean
  onChange: (rules: JournalMetricListRules) => void
}) {
  return (
    <>
      <p className={fieldCss.hint}>{t('journalMetricsListHint')}</p>
      <div className={css.metricPresets}>
        {JOURNAL_METRIC_LIST_PROFILES.map((profile) => (
          <Preset
            key={profile}
            t={t}
            profile={profile}
            rules={rules}
            disabled={disabled}
            onChange={onChange}
          />
        ))}
      </div>
      <div className={css.metricPresets}>
        <ChoiceField
          id="journal-metrics-dual-priority"
          label={t('journalMetricsDualPriority')}
          value={rules.dualPriority}
          options={JOURNAL_METRIC_LIST_PROFILES.map((value) => ({
            value,
            label: t(PROFILE_LABELS[value]),
          }))}
          disabled={disabled}
          onSelect={(value) => {
            const dualPriority = JOURNAL_METRIC_LIST_PROFILES.find((profile) => profile === value)
            if (dualPriority) onChange({ ...rules, dualPriority })
          }}
        />
        <ChoiceField
          id="journal-metrics-list-limit"
          label={t('journalMetricsListLimit')}
          value={String(rules.limit)}
          options={JOURNAL_METRIC_LIST_LIMITS.map((value) => ({
            value: String(value),
            label: t('journalMetricsListLimitOption', { count: value }),
          }))}
          disabled={disabled}
          onSelect={(value) => {
            const limit = JOURNAL_METRIC_LIST_LIMITS.find((count) => String(count) === value)
            if (limit) onChange({ ...rules, limit })
          }}
        />
      </div>
    </>
  )
}

/** Official EasyScholar fields selectable in settings. */
export const JOURNAL_METRIC_FIELDS = [
  'sci',
  'sciif',
  'sciUp',
  'sciUpSmall',
  'sciUpTop',
  'sciBase',
  'ssci',
  'jci',
  'sciif5',
  'ccf',
  'cssci',
  'cscd',
  'pku',
  'ei',
  'ahci',
  'sciwarn',
  'esi',
  'ajg',
  'fms',
  'udtd24',
  'ft50',
  'zhongguokejihexin',
  'swufe',
  'cufe',
  'uibe',
  'sdufe',
  'xdu',
  'swjtu',
  'ruc',
  'xmu',
  'sjtu',
  'fdu',
  'hhu',
  'scu',
  'cqu',
  'nju',
  'xju',
  'cug',
  'cju',
  'zju',
  'cpu',
  'xr',
  'xrWarn',
  'xrTop',
  'xrSmall',
] as const

export type JournalMetricField = (typeof JOURNAL_METRIC_FIELDS)[number]
export const JOURNAL_METRIC_DETAIL_FIELDS = [...JOURNAL_METRIC_FIELDS, 'custom'] as const
export type JournalMetricDetailField = (typeof JOURNAL_METRIC_DETAIL_FIELDS)[number]

export function journalMetricDetailFieldsOf(fields: readonly JournalMetricDetailField[]) {
  return JOURNAL_METRIC_DETAIL_FIELDS.filter((field) => fields.includes(field))
}

export const DEFAULT_JOURNAL_METRIC_DETAIL_FIELDS = Object.freeze([
  'sci',
  'sciif',
  'sciUp',
] as const)
export const JOURNAL_METRIC_LIST_CANDIDATES = ['jcr', ...JOURNAL_METRIC_FIELDS] as const
export const JOURNAL_METRIC_LIST_PROFILES = ['international', 'chineseCore'] as const
export const JOURNAL_METRIC_LIST_LIMITS = [1, 2, 3] as const
export type JournalMetricListCandidate = (typeof JOURNAL_METRIC_LIST_CANDIDATES)[number]
export type JournalMetricListProfile = (typeof JOURNAL_METRIC_LIST_PROFILES)[number]
export interface JournalMetricListRules {
  readonly international: readonly JournalMetricListCandidate[]
  readonly chineseCore: readonly JournalMetricListCandidate[]
  readonly dualPriority: JournalMetricListProfile
  readonly limit: (typeof JOURNAL_METRIC_LIST_LIMITS)[number]
}
const CHINESE_CORE_FIELDS = ['cssci', 'cscd', 'pku', 'zhongguokejihexin'] as const
const INTERNATIONAL_FIELDS: readonly JournalMetricField[] = [
  'sci',
  'ssci',
  'sciif',
  'sciif5',
  'jci',
  'sciBase',
  'sciUp',
  'sciUpSmall',
  'sciUpTop',
  'esi',
  'ei',
  'ahci',
]
export const DEFAULT_JOURNAL_METRIC_LIST: JournalMetricListRules = Object.freeze({
  international: Object.freeze(['jcr', 'sciif', 'sciUp'] as const),
  chineseCore: Object.freeze(CHINESE_CORE_FIELDS),
  dualPriority: 'international',
  limit: 3,
})
export const EASYSCHOLAR_SECRET_KEY_REF = 'EASYSCHOLAR_SECRET_KEY'
export const JOURNAL_NAME_MAX_LENGTH = 1024
export const JOURNAL_METRIC_FAILURES = [
  'credential',
  'rateLimited',
  'quotaExceeded',
  'requestRejected',
  'invalidResponse',
  'serviceUnavailable',
  'connectionFailed',
  'timedOut',
  'unavailable',
] as const
export type JournalMetricFailure = (typeof JOURNAL_METRIC_FAILURES)[number]

function isLegacyOrder(value: unknown): value is readonly JournalMetricField[] {
  return (
    Array.isArray(value) &&
    JOURNAL_METRIC_LIST_LIMITS.some((length) => length === value.length) &&
    new Set(value).size === value.length &&
    value.every((field) => JOURNAL_METRIC_FIELDS.includes(field))
  )
}

export function isJournalMetricListRules(value: unknown): value is JournalMetricListRules {
  if (value === null || typeof value !== 'object' || Object.keys(value).length !== 4) return false
  const list = value as JournalMetricListRules
  return (
    JOURNAL_METRIC_LIST_PROFILES.includes(list.dualPriority) &&
    JOURNAL_METRIC_LIST_LIMITS.includes(list.limit) &&
    JOURNAL_METRIC_LIST_PROFILES.every((profile) => {
      const candidates = list[profile]
      return (
        Array.isArray(candidates) &&
        new Set(candidates).size === candidates.length &&
        candidates.every((candidate) => JOURNAL_METRIC_LIST_CANDIDATES.includes(candidate))
      )
    })
  )
}

/** Resolve a saved single-order profile or an existing rule set into list rules. */
export function journalMetricListRulesOf(value: unknown): JournalMetricListRules | undefined {
  if (isJournalMetricListRules(value)) return value
  if (!isLegacyOrder(value)) return undefined
  if (value.join(',') === DEFAULT_JOURNAL_METRIC_DETAIL_FIELDS.join(',')) {
    return DEFAULT_JOURNAL_METRIC_LIST
  }
  const international = value.filter((field) => !CHINESE_CORE_FIELDS.some((core) => core === field))
  const chineseCore = value.filter((field) => !INTERNATIONAL_FIELDS.includes(field))
  return {
    international: international.length ? international : DEFAULT_JOURNAL_METRIC_LIST.international,
    chineseCore: chineseCore.length ? chineseCore : DEFAULT_JOURNAL_METRIC_LIST.chineseCore,
    dualPriority: DEFAULT_JOURNAL_METRIC_LIST.dualPriority,
    limit: value.length as JournalMetricListRules['limit'],
  }
}

export function journalMetricListValues(
  official: readonly { readonly field: string; readonly value: string }[],
  rules: JournalMetricListRules,
  compact: boolean,
): { field: JournalMetricField; value: string }[] {
  const values = new Map(official.map(({ field, value }) => [field, value]))
  const international = INTERNATIONAL_FIELDS.some((field) => values.has(field))
  const chineseCore = CHINESE_CORE_FIELDS.some((field) => values.has(field))
  const secondary = rules.dualPriority === 'international' ? 'chineseCore' : 'international'
  const candidates =
    international && chineseCore
      ? rules[rules.dualPriority]
      : international
        ? rules.international
        : chineseCore
          ? rules.chineseCore
          : [...rules[rules.dualPriority], ...rules[secondary]]
  const selected = new Map<JournalMetricField, string>()
  const limit = compact ? Math.min(2, rules.limit) : rules.limit
  for (const candidate of candidates) {
    const field = candidate === 'jcr' ? (values.has('sci') ? 'sci' : 'ssci') : candidate
    const value = values.get(field)
    if (value === undefined) continue
    selected.set(field, value)
    if (selected.size >= limit) break
  }
  return Array.from(selected, ([field, value]) => ({ field, value }))
}

export function isJournalMetricDetailFields(
  value: unknown,
): value is readonly JournalMetricDetailField[] {
  return (
    Array.isArray(value) &&
    new Set(value).size === value.length &&
    value.every((field) => JOURNAL_METRIC_DETAIL_FIELDS.includes(field))
  )
}

export function journalNameOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const name = value.trim().normalize('NFC')
  return name && name.length <= JOURNAL_NAME_MAX_LENGTH ? name : undefined
}

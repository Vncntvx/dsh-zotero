import type { JournalMetricFailure, JournalMetricField } from '../journal-metrics.ts'

type JournalMetricLabelKey = `journalMetric.${JournalMetricField}`

export const journalMetricFailureLabels = {
  credential: 'journalMetricsCredential',
  rateLimited: 'journalMetricsRateLimited',
  quotaExceeded: 'journalMetricsQuotaExceeded',
  requestRejected: 'journalMetricsRequestRejected',
  invalidResponse: 'journalMetricsInvalidResponse',
  serviceUnavailable: 'journalMetricsServiceUnavailable',
  connectionFailed: 'journalMetricsConnectionFailed',
  timedOut: 'journalMetricsTimedOut',
  unavailable: 'journalMetricsUnavailable',
} as const satisfies Record<JournalMetricFailure, string>

const labels = {
  'journalMetric.sci': ['JCR quartile', 'JCR 分区'],
  'journalMetric.sciif': ['JCR impact factor', 'JCR 影响因子'],
  'journalMetric.sciUp': ['CAS upgraded quartile', '中科院升级版分区'],
  'journalMetric.sciUpSmall': ['CAS small-category quartile', '中科院升级版小类分区'],
  'journalMetric.sciUpTop': ['CAS top journal', '中科院升级版 Top'],
  'journalMetric.sciBase': ['CAS basic quartile', '中科院基础版分区'],
  'journalMetric.ssci': ['SSCI JCR quartile', 'SSCI JCR 分区'],
  'journalMetric.jci': ['Journal Citation Indicator', 'JCI 指数'],
  'journalMetric.sciif5': ['5-year JCR impact factor', 'JCR 五年影响因子'],
  'journalMetric.ccf': ['CCF', 'CCF'],
  'journalMetric.cssci': ['CSSCI', '南大核心'],
  'journalMetric.cscd': ['CSCD', 'CSCD'],
  'journalMetric.pku': ['PKU Core Journals', '北大核心'],
  'journalMetric.ei': ['EI', 'EI 检索'],
  'journalMetric.ahci': ['A&HCI', 'A&HCI'],
  'journalMetric.sciwarn': ['CAS journal warning', '中科院预警'],
  'journalMetric.esi': ['ESI subject', 'ESI 学科'],
  'journalMetric.ajg': ['ABS Academic Journal Guide', 'ABS 学术期刊指南'],
  'journalMetric.fms': ['FMS', 'FMS'],
  'journalMetric.udtd24': ['UTD24', 'UTD24'],
  'journalMetric.ft50': ['FT50', 'FT50'],
  'journalMetric.zhongguokejihexin': [
    'China Science and Technology Core Journals',
    '中国科技核心期刊',
  ],
  'journalMetric.swufe': ['SWUFE', '西南财经大学'],
  'journalMetric.cufe': ['CUFE', '中央财经大学'],
  'journalMetric.uibe': ['UIBE', '对外经济贸易大学'],
  'journalMetric.sdufe': ['SDUFE', '山东财经大学'],
  'journalMetric.xdu': ['Xidian University', '西安电子科技大学'],
  'journalMetric.swjtu': ['SWJTU', '西南交通大学'],
  'journalMetric.ruc': ['Renmin University of China', '中国人民大学'],
  'journalMetric.xmu': ['Xiamen University', '厦门大学'],
  'journalMetric.sjtu': ['Shanghai Jiao Tong University', '上海交通大学'],
  'journalMetric.fdu': ['Fudan University', '复旦大学'],
  'journalMetric.hhu': ['Hohai University', '河海大学'],
  'journalMetric.scu': ['Sichuan University', '四川大学'],
  'journalMetric.cqu': ['Chongqing University', '重庆大学'],
  'journalMetric.nju': ['Nanjing University', '南京大学'],
  'journalMetric.xju': ['Xinjiang University', '新疆大学'],
  'journalMetric.cug': ['China University of Geosciences', '中国地质大学'],
  'journalMetric.cju': ['Yangtze University', '长江大学'],
  'journalMetric.zju': ['Zhejiang University', '浙江大学'],
  'journalMetric.cpu': ['China Pharmaceutical University', '中国药科大学'],
  'journalMetric.xr': ['Xinrui Academic', '新锐学术'],
  'journalMetric.xrWarn': ['Xinrui Academic warning', '新锐学术预警'],
  'journalMetric.xrTop': ['Xinrui Academic top journal', '新锐学术 Top'],
  'journalMetric.xrSmall': ['Xinrui Academic small category', '新锐学术小类分区'],
} as const satisfies Record<JournalMetricLabelKey, readonly [string, string]>

function labelsFor(language: 0 | 1): Record<JournalMetricLabelKey, string> {
  return Object.fromEntries(
    Object.entries(labels).map(([key, pair]) => [key, pair[language]]),
  ) as Record<JournalMetricLabelKey, string>
}
export const journalMetricEn = labelsFor(0)
export const journalMetricZh = labelsFor(1)

export function journalMetricLabel(
  field: string,
  t: (key: JournalMetricLabelKey) => string,
): string {
  const key = `journalMetric.${field}` as JournalMetricLabelKey
  return Object.hasOwn(labels, key) ? t(key) : field
}

export function journalMetricSummaryLabel(
  field: JournalMetricField,
  t: (key: JournalMetricLabelKey | 'journalMetricsCasShort') => string,
): string {
  switch (field) {
    case 'sci':
      return 'JCR'
    case 'ssci':
      return 'SSCI'
    case 'sciif':
      return 'IF'
    case 'sciUp':
      return t('journalMetricsCasShort')
    default:
      return journalMetricLabel(field, t)
  }
}

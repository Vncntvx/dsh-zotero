/**
 * The concept-paraphrase regression set for evidence ranking.
 *
 * Every case is a small passage corpus with one genuinely relevant answer and
 * one function-word-only "table sentence" as a control. Paraphrase answers
 * deliberately share no content term with the question, so a term-overlap
 * ranker cannot find them; lexical controls do share terms and must stay
 * findable. The two metrics and their targets are fixed here so no later stage
 * can loosen them after seeing a result.
 *
 * This module is pure data and pure predicates: it imports nothing from `src/`,
 * so both the local and the scholarly lane can drive it with their own
 * ranking entry point, and a baseline generator can load it as plain data.
 * @module tests/helpers/semantic-recall-fixtures
 */

export type RecallLanguage = 'en' | 'zh'
export type RecallCaseKind = 'paraphrase' | 'lexical' | 'duplicate'

export interface RecallCase {
  readonly id: string
  readonly language: RecallLanguage
  readonly kind: RecallCaseKind
  readonly query: string
  readonly passages: readonly string[]
  /** Indices of passages that genuinely answer `query`. */
  readonly relevant: readonly number[]
  /** Index of the function-word-only control passage. */
  readonly generic: number
}

/** Fixed in stage 0. Stage 4 must reach these, not redefine them. */
export const RECALL_AT_4_TARGET = 0.9
export const MRR_TARGET = 0.75
export const RECALL_TOP_K = 4

/** A minimal ranked passage shape both lanes can project to. */
export interface RecallRanked {
  readonly index: number
  readonly score: number
}

export interface RecallMetrics {
  readonly cases: number
  readonly recallAt4: number
  readonly mrr: number
  /** Cases whose function-word-only control reached the top two. */
  readonly genericTop2: number
  /** Per-case top-k indices, in case order; the committed baseline's audit trail. */
  readonly top4: readonly (readonly number[])[]
}

/** Neutral hard negatives. None contains a content term from any query. */
const EN_DISTRACTORS: readonly string[] = [
  'Irrigation scheduling in arid basins depends on soil salinity readings.',
  'Stellar spectroscopy resolves metallicity from narrow absorption bands.',
  'Medieval manuscript cataloguing records watermarks and quire structure.',
  'Harbour sediment sampling tracks grain size across tidal cycles.',
  'Alpine beetle distribution follows elevation and snow cover duration.',
  'Railway timetable optimisation minimises platform conflicts at junctions.',
  'Ceramic glaze chemistry controls craquelure through thermal expansion.',
  'Transformer winding insulation ages under repeated thermal cycling.',
]

const ZH_DISTRACTORS: readonly string[] = [
  '干旱灌区的灌溉调度取决于土壤盐分读数。',
  '恒星光谱通过窄吸收带测定金属丰度。',
  '中世纪手稿编目记录水印与书帖结构。',
  '港口沉积物采样追踪潮周期中的粒径变化。',
  '高山甲虫分布随海拔与积雪时长变化。',
  '铁路时刻表优化减少枢纽站台冲突。',
  '陶瓷釉料化学经由热膨胀控制开片。',
  '变压器绕组绝缘在反复热循环下老化。',
]

const GENERIC_TEXT: Readonly<Record<RecallLanguage, string>> = {
  en: 'Table 2 reports the and of the in the with the and the',
  zh: '表二所列之其与并在了的和及以',
}

/** Rotate a pool deterministically so consecutive cases see different negatives. */
function rotated(pool: readonly string[], offset: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => pool[(offset + i) % pool.length]!)
}

type CaseRow = readonly [
  id: string,
  language: RecallLanguage,
  kind: RecallCaseKind,
  query: string,
  answer: string,
]

const ROWS: readonly CaseRow[] = [
  [
    'en-01',
    'en',
    'paraphrase',
    'What mechanisms explain the relationship between institutional trust and compliance?',
    'The role of perceived legitimacy in regulatory adherence.',
  ],
  [
    'en-02',
    'en',
    'paraphrase',
    'Why do citizens follow rules they consider fair?',
    'Procedural justice increases voluntary acceptance of authority decisions.',
  ],
  [
    'en-03',
    'en',
    'paraphrase',
    'How do bacteria attach to surfaces?',
    'Microbial adhesion is governed by extracellular polymer production.',
  ],
  [
    'en-04',
    'en',
    'paraphrase',
    'What sustains cooperation when a resource is shared?',
    'Common-pool dilemmas are mitigated by reciprocal norms and monitoring.',
  ],
  [
    'en-05',
    'en',
    'paraphrase',
    'How does sleep deprivation affect memory?',
    'Hippocampal consolidation deteriorates after prolonged wakefulness.',
  ],
  [
    'en-06',
    'en',
    'paraphrase',
    'Why do prices rise when supply falls?',
    'Scarcity of available units bids up the equilibrium clearing level.',
  ],
  [
    'en-07',
    'en',
    'paraphrase',
    'What makes a vaccine protective?',
    'Neutralising antibody titres correlate with reduced clinical attack rates.',
  ],
  [
    'en-08',
    'en',
    'paraphrase',
    'Why do firms adopt new standards?',
    'Organisational conformance follows isomorphic pressure from regulators.',
  ],
  [
    'en-09',
    'en',
    'paraphrase',
    'Which design choices reduce energy use in buildings?',
    'Passive ventilation and thermal mass lower the cooling load.',
  ],
  [
    'en-10',
    'en',
    'paraphrase',
    'How do voters react to corruption scandals?',
    'Incumbent electoral penalties widen where accountability is salient.',
  ],
  [
    'en-11',
    'en',
    'lexical',
    'institutional trust and compliance',
    'Institutional trust predicts compliance with reporting duties.',
  ],
  [
    'en-12',
    'en',
    'duplicate',
    'trust trust trust compliance compliance',
    'Public trust in institutions shapes voluntary compliance.',
  ],
  ['zh-01', 'zh', 'paraphrase', '制度信任与合规之间是什么关系？', '感知正当性在监管遵从中的作用'],
  ['zh-02', 'zh', 'paraphrase', '为什么公民愿意遵守公平的规则', '程序正义提升自愿接受权威决定'],
  ['zh-03', 'zh', 'paraphrase', '细菌如何附着在表面', '微生物黏附受胞外聚合物支配'],
  ['zh-04', 'zh', 'paraphrase', '公共资源中的合作如何维持', '互惠规范与监督缓解公地困境'],
  ['zh-05', 'zh', 'paraphrase', '睡眠不足怎样影响记忆', '长时间清醒损害海马巩固'],
  ['zh-06', 'zh', 'paraphrase', '供给下降为何推高价格', '可得单位稀缺抬升均衡出清水平'],
  ['zh-07', 'zh', 'paraphrase', '疫苗为何具有保护作用', '中和抗体滴度与临床发作率下降相关'],
  ['zh-08', 'zh', 'paraphrase', '企业为何采纳新标准', '规制压力下的组织趋同与合规'],
  ['zh-09', 'zh', 'paraphrase', '哪些设计能降低建筑能耗', '自然通风与蓄热体削减冷负荷'],
  ['zh-10', 'zh', 'paraphrase', '选民怎样回应腐败丑闻', '问责显著时现任者的选举惩罚扩大'],
  ['zh-11', 'zh', 'lexical', '制度信任 合规', '制度信任水平影响合规行为'],
  ['zh-12', 'zh', 'duplicate', '合规 合规 合规 信任 信任', '合规行为与信任水平相关'],
]

/** Eight passages per case: control, answer, then six rotated neutral negatives. */
export const RECALL_CASES: readonly RecallCase[] = ROWS.map(
  ([id, language, kind, query, answer], i) => ({
    id,
    language,
    kind,
    query,
    passages: [
      GENERIC_TEXT[language],
      answer,
      ...rotated(language === 'en' ? EN_DISTRACTORS : ZH_DISTRACTORS, i * 2, 6),
    ],
    relevant: [1],
    generic: 0,
  }),
)

const round = (value: number): number => Number(value.toFixed(6))

/**
 * Score a ranker over the regression set. A returned entry is a match; rankers
 * drop zero-score passages as `zotero_retrieve` and `scholarly_read` do, so the
 * metric reflects what a caller receives. Asynchronous because the ranking seam
 * is, so stage 4 can swap the ranker without rewriting either lane.
 * @param cases - the regression cases to score.
 * @param rank - the ranker under test, one call per case.
 * @returns the metrics plus each case's top-4 indices.
 */
export async function measureRecall(
  cases: readonly RecallCase[],
  rank: (item: RecallCase) => Promise<readonly RecallRanked[]>,
): Promise<RecallMetrics> {
  let recall = 0
  let reciprocal = 0
  let genericTop2 = 0
  const top4: number[][] = []
  for (const item of cases) {
    const ranked = (await rank(item)).filter((entry) => entry.score > 0)
    const indices = ranked.map((entry) => entry.index)
    const top = indices.slice(0, RECALL_TOP_K)
    top4.push(top)
    recall += item.relevant.filter((index) => top.includes(index)).length / item.relevant.length
    const first = indices.findIndex((index) => item.relevant.includes(index))
    reciprocal += first === -1 ? 0 : 1 / (first + 1)
    if (indices.slice(0, 2).includes(item.generic)) genericTop2 += 1
  }
  const n = cases.length
  return {
    cases: n,
    recallAt4: round(recall / n),
    mrr: round(reciprocal / n),
    genericTop2,
    top4,
  }
}

/**
 * Build the document `scholarly_read query` would chunk: one padded unit per
 * passage, each exactly `chunkWords` word spans wide, so `chunkText` yields one
 * chunk per passage and the ranked spans map back to passage indices.
 * `wordCount` is injected so this helper stays free of `src/` imports.
 */
export function scholarlyDocumentOf(
  item: RecallCase,
  wordCount: (text: string) => number,
  chunkWords = 32,
): { readonly text: string; readonly starts: readonly number[] } {
  const units = item.passages.map((passage) => {
    const words = wordCount(passage)
    if (words > chunkWords) {
      throw new Error(`${item.id}: a passage has ${words} words, exceeding ${chunkWords}`)
    }
    const padding = Array.from({ length: chunkWords - words }, () => 'zqx').join(' ')
    return padding === '' ? passage : `${passage} ${padding}`
  })
  const starts: number[] = []
  let offset = 0
  for (const unit of units) {
    starts.push(offset)
    offset += unit.length + 2
  }
  return { text: units.join('\n\n'), starts }
}

/** Map a chunk's start offset back to the index of the passage it belongs to. */
export function unitIndexOf(start: number, starts: readonly number[]): number {
  for (let i = starts.length - 1; i >= 0; i -= 1) {
    if (start >= starts[i]!) return i
  }
  return -1
}

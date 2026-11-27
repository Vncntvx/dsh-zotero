/** Configuration for the optional Reader component. */
import type { Volatile } from '@deepseek-ai/cordis'
import { isVolatile } from '@deepseek-ai/cosmokit'
import Schema from '@deepseek-ai/schemastery'
import { ZOTERO_READER_TRANSLATION_LANGUAGES } from '../constants.js'
import { schemaChoices } from '../schema-helpers.js'

const TRANSLATION_TARGETS = ['auto', ...ZOTERO_READER_TRANSLATION_LANGUAGES] as const
export type ReaderTranslationTarget = (typeof TRANSLATION_TARGETS)[number]

export interface ReaderConfig {
  historyLimit?: Volatile<number>
  persistReadingState?: Volatile<boolean>
  defaultTranslationTarget?: Volatile<ReaderTranslationTarget>
  captureWatermark?: Volatile<boolean>
}

export const ReaderConfigSchema = Schema.object({
  historyLimit: Schema.number()
    .default(50)
    .min(1)
    .max(500)
    .step(1)
    .description('Maximum Reader history entries retained in the browser.')
    .volatile(),
  persistReadingState: Schema.boolean()
    .default(true)
    .description('Persist attachment-scoped Reader position and viewing preferences.')
    .volatile(),
  defaultTranslationTarget: schemaChoices(TRANSLATION_TARGETS)
    .default('auto')
    .description('Default language for Reader selection translation.')
    .volatile(),
  captureWatermark: Schema.boolean()
    .default(false)
    .description('Include the document title and page labels in the PDF capture footer by default.')
    .volatile(),
})

export interface ResolvedReaderConfig {
  readonly historyLimit: number
  readonly persistReadingState: boolean
  readonly defaultTranslationTarget: ReaderTranslationTarget
  readonly captureWatermark: boolean
}

export function resolveReaderConfig(config: ReaderConfig): ResolvedReaderConfig {
  const historyLimit = config.historyLimit
  const persistReadingState = config.persistReadingState
  const defaultTranslationTarget = config.defaultTranslationTarget
  const captureWatermark = config.captureWatermark
  return {
    historyLimit:
      historyLimit === undefined
        ? 50
        : isVolatile(historyLimit)
          ? historyLimit.get()
          : historyLimit,
    persistReadingState:
      persistReadingState === undefined
        ? true
        : isVolatile(persistReadingState)
          ? persistReadingState.get()
          : persistReadingState,
    defaultTranslationTarget:
      defaultTranslationTarget === undefined
        ? 'auto'
        : isVolatile(defaultTranslationTarget)
          ? defaultTranslationTarget.get()
          : defaultTranslationTarget,
    captureWatermark:
      captureWatermark === undefined
        ? false
        : isVolatile(captureWatermark)
          ? captureWatermark.get()
          : captureWatermark,
  }
}

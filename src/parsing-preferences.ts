/**
 * Shared, host-free contract for the document-parsing component's settings.
 *
 * Kept dependency-free so the browser bundle may import it: the same choices,
 * defaults, and validation back the host Schemastery schema, the staged form
 * controller, and `resolveParsingConfig`. Malformed values are refused rather
 * than repaired, matching `library-preferences.ts`.
 * @module dsh-zotero/parsing-preferences
 */

/** The two MinerU APIs. `free` never reads the token; `pro` requires one. */
export const PARSING_MODE_CHOICES = ['free', 'pro'] as const
export type ParsingMode = (typeof PARSING_MODE_CHOICES)[number]

export interface ParsingPreferences {
  /** Which MinerU API to use. Independent of whether a token is configured. */
  readonly mode: ParsingMode
  /** Credential-reference name for the precise-API token (a name, never the value). */
  readonly mineruTokenRef: string
  /** Authorizes sending document bytes to MinerU (data egress). */
  readonly allowParsingUpload: boolean
  /** Absolute output directory; empty means the harness default is resolved at runtime. */
  readonly outputDir: string
}

export type ParsingPreferenceKey = keyof ParsingPreferences

export const PARSING_DEFAULTS: ParsingPreferences = Object.freeze({
  mode: 'free',
  mineruTokenRef: '',
  allowParsingUpload: false,
  outputDir: '',
})

export const PARSING_PREFERENCE_KEYS = Object.keys(PARSING_DEFAULTS) as ParsingPreferenceKey[]

/**
 * The shape of an output directory the settings form may save. Empty means the
 * default; otherwise the value must be a POSIX absolute path, a `~`/`~/...`
 * path, a Windows drive path, or a UNC path. Existence, writability, and
 * canonical safety are checked by the host on first use. Kept dependency-free
 * so the browser controller and the host schema share one rule.
 */
export const PARSING_OUTPUT_DIR_PATTERN = /^(?:$|~(?:\/|$)|\/|[A-Za-z]:[\\/]|\\\\)/

/** Whether a configured output-dir value has an allowed absolute shape. */
export function isParsingOutputDirPath(value: string): boolean {
  return PARSING_OUTPUT_DIR_PATTERN.test(value)
}

/** Resolve omitted fields only; malformed values are refused rather than repaired. */
export function parsingPreferencesOf(raw: Readonly<Record<string, unknown>>): ParsingPreferences {
  const mode = Object.hasOwn(raw, 'mode') ? raw.mode : PARSING_DEFAULTS.mode
  const mineruTokenRef = Object.hasOwn(raw, 'mineruTokenRef')
    ? raw.mineruTokenRef
    : PARSING_DEFAULTS.mineruTokenRef
  const allowParsingUpload = Object.hasOwn(raw, 'allowParsingUpload')
    ? raw.allowParsingUpload
    : PARSING_DEFAULTS.allowParsingUpload
  const outputDir = Object.hasOwn(raw, 'outputDir') ? raw.outputDir : PARSING_DEFAULTS.outputDir

  if (!(PARSING_MODE_CHOICES as readonly unknown[]).includes(mode)) {
    throw new Error('Invalid parsing preference: mode')
  }
  if (typeof mineruTokenRef !== 'string') {
    throw new Error('Invalid parsing preference: mineruTokenRef')
  }
  if (typeof allowParsingUpload !== 'boolean') {
    throw new Error('Invalid parsing preference: allowParsingUpload')
  }
  if (typeof outputDir !== 'string') {
    throw new Error('Invalid parsing preference: outputDir')
  }
  return Object.freeze({
    mode,
    mineruTokenRef,
    allowParsingUpload,
    outputDir,
  }) as ParsingPreferences
}

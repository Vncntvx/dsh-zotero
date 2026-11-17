/**
 * The model-facing name of the app's active interface language.
 *
 * The harness resolves the effective locale only in the browser. Explain and
 * ask prompts are assembled there, where `ctx.locale.getSnapshot().active`
 * gives the active id; this module writes that language directly into the
 * draft as one unambiguous label.
 *
 * A built-in table covers the harness's shipped locales. A language pack may
 * register any id, so an unknown id is named through `Intl.DisplayNames` in
 * English and in its own language, and a malformed tag falls back to the id
 * itself. The label is never empty.
 *
 * @module dsh-zotero/client/answer-language
 */

/** One language's English and native names. */
interface LanguageName {
  readonly english: string
  readonly native: string
}

/**
 * The locale service's active id, which a face passes to the resolver itself.
 * Both faces take the service rather than a pre-bound string so registration
 * stays a plain property assignment.
 */
export interface AnswerLanguageSource {
  getSnapshot(): { readonly active: string }
}

/**
 * The harness's shipped locales plus the regional Chinese variants a language
 * pack may register. Keys are normalized locale ids.
 */
const BUILT_IN: Readonly<Record<string, LanguageName>> = {
  en: { english: 'English', native: 'English' },
  zh: { english: 'Simplified Chinese', native: '简体中文' },
  'zh-tw': { english: 'Traditional Chinese', native: '繁體中文' },
  'zh-hk': { english: 'Traditional Chinese', native: '繁體中文' },
  'zh-hant': { english: 'Traditional Chinese', native: '繁體中文' },
  ja: { english: 'Japanese', native: '日本語' },
  es: { english: 'Spanish', native: 'Español' },
  fr: { english: 'French', native: 'Français' },
  de: { english: 'German', native: 'Deutsch' },
  ru: { english: 'Russian', native: 'Русский' },
  pt: { english: 'Portuguese', native: 'Português' },
}

/** Normalize one locale id for the table lookup. */
function localeKeyOf(id: string): string {
  return id.trim().replace(/_/gu, '-').toLowerCase()
}

/**
 * The table key for a normalized id. A regional Chinese tag keeps its script
 * distinction; every other region collapses to its primary language, because
 * the harness resolves a browser tag by full tag and then primary subtag.
 * @param key - the normalized locale id.
 * @returns the id to look up in {@link BUILT_IN}.
 */
function tableKeyOf(key: string): string {
  if (key === 'zh-tw' || key === 'zh-hk' || key === 'zh-hant') return key
  return key.split('-')[0] ?? key
}

/**
 * A display name from `Intl.DisplayNames`, or undefined when the runtime or
 * the tag refuses it. This is the only dynamic path; the table covers the
 * common languages without it.
 * @param languages - the display locale order.
 * @param id - the language id to name.
 * @returns the name, or undefined.
 */
function displayNameOf(languages: readonly string[], id: string): string | undefined {
  try {
    return new Intl.DisplayNames(languages, { type: 'language' }).of(id)
  } catch {
    return undefined
  }
}

/**
 * Describe the active interface language for a model prompt.
 * @param active - the client locale service's active id, such as `zh` or an
 * installed language pack's id.
 * @returns a label such as `Simplified Chinese (简体中文, zh)`; never empty.
 */
export function answerLanguageOf(active: string): string {
  const id = active.trim() === '' ? 'en' : active.trim()
  const key = tableKeyOf(localeKeyOf(id))
  const builtIn = BUILT_IN[key]
  if (builtIn !== undefined) {
    return builtIn.native === builtIn.english
      ? `${builtIn.english} (${id})`
      : `${builtIn.english} (${builtIn.native}, ${id})`
  }
  const english = displayNameOf(['en'], id) ?? id
  const native = displayNameOf([id], id) ?? id
  return native === english ? `${english} (${id})` : `${english} (${native}, ${id})`
}

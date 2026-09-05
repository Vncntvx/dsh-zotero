/**
 * Shared locale stub for client specs: exact local mirror of the harness
 * `makeTranslate` (`packages/test-support/client-runtime/src/translate.ts`).
 * Kept local (rather than depending on `@deepseek-ai/dsh-client-test-runtime`)
 * because that package's `0.1.3-alpha.1` line is not yet published and would
 * break `npm install`, and pulling the full jsdom slot runtime for one pure
 * function is disproportionate. Resolution order and `{name}` interpolation
 * match `LocaleRuntime` exactly: first dictionary owning the key wins, then
 * the key itself stays visible; unknown placeholders stay verbatim.
 * @module tests/client/helpers/mock-translate
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { zh } from '../../../src/client/locales.ts'

/**
 * Build a translate stub resolving through `dicts` in order (namespace
 * first, then the shared common vocabulary), falling back to the key.
 * @param dicts - dictionaries consulted in order.
 * @returns the translate function (assignable to any `XxxProps['t']` seat).
 */
export function makeTranslate(
  ...dicts: readonly Record<string, string>[]
): (key: string, params?: Record<string, unknown>) => string {
  return (key, params) => {
    let template = key
    for (const dict of dicts) {
      const hit = dict[key]
      if (hit !== undefined) {
        template = hit
        break
      }
    }
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in params ? String(params[name]) : whole,
    )
  }
}

/** A `t` stub backed by the real `zh` dictionary with real param interpolation. */
export const mockT: TranslateNS<'zotero'> = makeTranslate(zh) as TranslateNS<'zotero'>

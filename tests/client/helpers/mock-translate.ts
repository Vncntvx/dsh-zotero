/**
 * Shared locale stub for client specs: exact local mirror of the harness
 * `makeTranslate` (`packages/test-support/client-runtime/src/translate.ts`).
 *
 * Kept local rather than imported from `@deepseek-ai/dsh-client-test-runtime`.
 * The package *is* published at the current pin, but installing it grows the
 * dev graph by 28 packages: its peer set requires six harness packages this
 * plugin does not carry (`dsh-client-web`, `dsh-client-hmr`,
 * `dsh-client-modules`, `dsh-remote-mock`, `dsh-api-workspace-controller`,
 * `dsh-host-directory-picker`), and its hard `vitest ^4.1.11` dependency nests
 * a second test runner beside this repo's v5. Its root entry loads the whole
 * jsdom slot runtime, so even a pure function costs every importing spec that
 * load (the constraint and the measurement are in `docs/development.md`).
 *
 * Resolution order and `{name}` interpolation
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

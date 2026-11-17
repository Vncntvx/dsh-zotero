/** Public harness locale fixtures shared by the browser lane. */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime/src/translate.ts'
import { zh } from '../../../src/client/locales.ts'

export { makeTranslate }

/** The shared Zotero dictionary, using the harness lookup and interpolation. */
export const mockT: TranslateNS<'zotero'> = makeTranslate(zh) as TranslateNS<'zotero'>

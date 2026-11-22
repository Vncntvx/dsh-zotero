/**
 * The panel's own navigation and paging failures, worded in the reader's
 * language.
 *
 * These arms are the client's sanity checks over what the host answered: an
 * impossible page, a library that moved mid-read, a list that answered for
 * another session. Their text used to be English sentences rendered verbatim
 * under every locale. Each now carries a locale key, and the surface that
 * catches it translates the key; a failure that came from anywhere else keeps
 * its own message and is quoted inside one localized wrapper sentence, so a
 * Chinese panel never shows an ASCII paragraph mid-sentence.
 * @module dsh-zotero/client/components/library/library-errors
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { messageOf } from '../../error-text.ts'

/** The locale keys a client-authored navigation failure can name. */
type LibraryFailureKey =
  | 'libraryErrorVersion'
  | 'libraryErrorChanging'
  | 'libraryErrorPagination'
  | 'libraryErrorScopeMissing'
  | 'libraryErrorSavedSearchGone'
  | 'libraryErrorPathChanged'
  | 'libraryErrorPathFailed'
  | 'libraryErrorForeignSession'
  | 'libraryErrorChildKind'
  | 'libraryErrorListingStalled'

/** One client-authored navigation failure, named by its locale key. */
export class LibraryFailure extends Error {
  /**
   * @param code - the locale key naming what the client refused to accept.
   */
  constructor(readonly code: LibraryFailureKey) {
    super(code)
    this.name = 'LibraryFailure'
  }
}

/**
 * The stored form of one lane failure.
 *
 * A {@link LibraryFailure} contributes its locale key, which is the stable
 * code the specs pin. Anything else is a message the panel did not author —
 * most often a host refusal — and is stored verbatim for
 * {@link laneTextOf} to quote.
 * @param error - the caught value.
 * @returns the string a lane stores.
 */
export function laneFailureOf(error: unknown): string {
  return error instanceof LibraryFailure ? error.code : messageOf(error)
}

/**
 * The visible text of one stored lane failure.
 *
 * The authored codes all share the `libraryError` prefix, which no foreign
 * message in this panel does; a code is translated, and a foreign message is
 * kept verbatim inside one localized wrapper sentence. One discriminator, in
 * one place, rather than a parallel copy of either in every component.
 * @param message - the stored lane message.
 * @param t - the rendering surface's translate seat.
 * @returns the text to render.
 */
export function laneTextOf(message: string, t: TranslateNS<'zotero'>): string {
  return message.startsWith('libraryError')
    ? t(message as LibraryFailureKey)
    : t('libraryErrorDetail', { message })
}

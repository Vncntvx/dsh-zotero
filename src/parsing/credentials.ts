/**
 * Resolve the MinerU precise-API token through the harness credentials seam.
 *
 * Configuration carries a credential-reference name only; the value lives in
 * the host credentials provider and is re-read before every parse. Fail-closed:
 * a non-empty reference that cannot be resolved is a configuration failure,
 * never a silent fallback to the free API or an anonymous request. The free
 * API never calls this module at all.
 * @module dsh-zotero/parsing/credentials
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { ZOTERO_PARSING_CREDENTIAL_UNRESOLVED, ZoteroError } from '../errors.js'

/**
 * Resolve the precise-API token for one parse.
 * @param ctx - the parsing component's context.
 * @param reference - the configured credential-reference name (trimmed).
 * @returns the token value.
 * @throws {ZoteroError} `ZOTERO_PARSING_CREDENTIAL_UNRESOLVED` when the reference
 *   is invalid, the credentials seam is absent, or the value is empty.
 */
export async function resolveMineruToken(ctx: Context, reference: string): Promise<string> {
  let ref: ReturnType<typeof credentialRef>
  try {
    ref = credentialRef(reference)
  } catch (error) {
    throw new ZoteroError(
      `MinerU credential reference "${reference}" is not a valid environment-variable name.`,
      ZOTERO_PARSING_CREDENTIAL_UNRESOLVED,
      { cause: error },
    )
  }
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    throw new ZoteroError(
      `MinerU credential reference "${reference}" is configured, but the credentials service is not composed.`,
      ZOTERO_PARSING_CREDENTIAL_UNRESOLVED,
    )
  }
  const value = await credentials.resolve(ref)
  if (value === undefined || value.value.trim() === '') {
    throw new ZoteroError(
      `MinerU credential reference "${reference}" is configured but has no value. Store the token under that reference, or switch the parsing mode back to free.`,
      ZOTERO_PARSING_CREDENTIAL_UNRESOLVED,
    )
  }
  return value.value.trim()
}

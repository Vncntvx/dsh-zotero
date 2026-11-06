/**
 * A credential-port stand-in for client settings specs: no key configured,
 * every reference writable, and every set accepted. Specs that assert
 * credential behavior use their own recording port.
 * @module tests/client/helpers/credential-port
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ScholarlyCredentialInfo,
  ScholarlyCredentialPort,
} from '../../../src/client/scholarly-form-controller.ts'

/** A silent credential port for forms that do not exercise key writes. */
export const emptyCredentialPort: ScholarlyCredentialPort = {
  async describe(refs) {
    const value: Record<string, ScholarlyCredentialInfo> = {}
    for (const ref of refs) value[ref] = { configured: false, writable: true }
    return { ok: true, value } as RemoteResult<Record<string, ScholarlyCredentialInfo>>
  },
  async set() {
    return { ok: true, value: undefined } as RemoteResult<unknown>
  },
}

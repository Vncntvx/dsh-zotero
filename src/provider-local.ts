/**
 * The `local` provider: the Zotero Local API at `127.0.0.1:23119/api`.
 * Capabilities are declared only for what this provider currently
 * implements, so a capability gate can never route work into a method that
 * does not exist.
 * @module dsh-zotero/provider-local
 */

import { ZoteroHttpClient } from './client.js'
import { errorMessageOf } from './errors.js'
import type { ZoteroCapability, ZoteroProvider, ZoteroStatus } from './types.js'

export const LOCAL_PROVIDER_ID = 'local'

export class LocalApiProvider implements ZoteroProvider {
  readonly id = LOCAL_PROVIDER_ID
  readonly capabilities: ReadonlySet<ZoteroCapability> = new Set<ZoteroCapability>(['metadata'])

  constructor(private readonly client: ZoteroHttpClient) {}

  /**
   * Probe `GET /api/` and report connectivity plus the instance identity
   * headers. Health checks live here, not on every tool call.
   */
  async status(signal?: AbortSignal): Promise<ZoteroStatus> {
    try {
      const { headers } = await this.client.get('', undefined, { signal })
      return {
        providerId: this.id,
        connected: true,
        apiVersion: headers.get('zotero-api-version') ?? undefined,
        serverId: headers.get('zotero-server-id') ?? undefined,
        schemaVersion: headers.get('zotero-schema-version') ?? undefined,
        diagnosis: 'ok',
      }
    } catch (error) {
      return {
        providerId: this.id,
        connected: false,
        diagnosis: errorMessageOf(error),
      }
    }
  }
}

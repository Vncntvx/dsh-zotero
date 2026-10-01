/**
 * Shared harness for the provider contract specs (`tests/provider/*.spec.ts`).
 *
 * Each spec boots a fresh mock Zotero server plus a `LocalApiProvider` over
 * the real HTTP client; the request builders and the typed-error assertion
 * helper live here because every provider spec uses them. Domain fixtures
 * stay in the spec file that owns them.
 * @module tests/helpers/provider-harness
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalApiProvider } from '../../src/local/provider.js'
import type { LocalApiLimits } from '../../src/local/limits.js'
import { parseRef } from '../../src/refs.js'
import type {
  ZoteroExportRequest,
  ZoteroGetRequest,
  ZoteroRetrieveRequest,
  ZoteroSearchRequest,
} from '../../src/types.js'
import { MockZotero } from './mock-zotero.js'
import { testHttpClient } from './test-clients.js'

/**
 * The limits every provider-facing spec starts from; a spec passes overrides
 * through `createProvider`/`setupProvider` or a spread. Kept here as the one
 * home so a new `LocalApiLimits` member costs one edit.
 */
export const PROVIDER_LIMITS: LocalApiLimits = {
  maxNoteScanRecords: 200,
  maxDetailChars: 500,
  maxNoteBodyChars: 30_000,
  maxNoteChars: 2000,
  maxNoteRecords: 50,
  maxAnnotationRecords: 100,
  fulltextChunkWords: 200,
  maxEvidenceChars: 6000,
  maxEvidencePassages: 4,
  maxFulltextChars: 100_000,
  maxExportChars: 1_000_000,
  defaultStyle: 'apa',
  defaultLocale: 'en-US',
  maxBrowseResults: 50,
  maxChangesResults: 50,
  scopeListingTtlMs: 30_000,
  searchConcurrency: 4,
  graphConcurrency: 4,
  retrieveAttachmentCap: 16,
}

/** A provider over the given mock server's base URL, with optional limit overrides. */
export function createProvider(
  mock: MockZotero,
  limits: Partial<LocalApiLimits> = {},
): LocalApiProvider {
  return new LocalApiProvider(testHttpClient(mock.baseUrl), { ...PROVIDER_LIMITS, ...limits })
}

/** The per-test harness state: the mock server, the provider, and a temp dir. */
export interface ProviderHarness {
  readonly mock: MockZotero
  readonly provider: LocalApiProvider
  readonly tempDir: string
}

/** Boot a mock Zotero server and a provider over it; call {@link teardownProvider} after. */
export async function setupProvider(
  limits: Partial<LocalApiLimits> = {},
): Promise<ProviderHarness> {
  const mock = await MockZotero.start()
  return {
    mock,
    provider: createProvider(mock, limits),
    tempDir: mkdtempSync(join(tmpdir(), 'dsh-zotero-')),
  }
}

/** Close the mock server and remove the temp dir. */
export async function teardownProvider(harness: ProviderHarness): Promise<void> {
  await harness.mock.close()
  rmSync(harness.tempDir, { recursive: true, force: true })
}

/** A metadata-only get request for the fixture item ABCD1234. */
export function getRequest(
  include: ('notes' | 'annotations' | 'attachments')[] = [],
): ZoteroGetRequest {
  return { ref: parseRef('zotero://user/0/item/ABCD1234'), include: new Set(include) }
}

/** A retrieve request for the fixture item ABCD1234 with every source. */
export function retrieveRequest(
  overrides: Partial<ZoteroRetrieveRequest> = {},
): ZoteroRetrieveRequest {
  return {
    ref: parseRef('zotero://user/0/item/ABCD1234'),
    query: 'flash attention',
    sources: ['annotation', 'note', 'abstract', 'fulltext'],
    passages: 4,
    ...overrides,
  }
}

/** A citation export request for the two fixture items, in that order. */
export function exportRequest(overrides: Partial<ZoteroExportRequest> = {}): ZoteroExportRequest {
  return {
    refs: [parseRef('zotero://user/0/item/ABCD1234'), parseRef('zotero://user/0/item/BBBB1234')],
    format: 'citation',
    ...overrides,
  }
}

/** A plain library search request. */
export function request(overrides: Partial<ZoteroSearchRequest> = {}): ZoteroSearchRequest {
  return {
    scope: { kind: 'library' },
    mode: 'metadata',
    sort: 'dateModified',
    direction: 'desc',
    offset: 0,
    limit: 10,
    ...overrides,
  }
}

/**
 * The typed-error assertion is shared with the tool and host lanes, so its one
 * definition lives with the other wire assertions. Re-exported here because
 * this module is the provider lane's single import surface.
 */
export { zoteroError } from './server/assert.js'

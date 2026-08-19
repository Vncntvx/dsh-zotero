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
import { expect } from 'vitest'
import { ZoteroError } from '../../src/errors.js'
import { ZoteroHttpClient } from '../../src/http-client.js'
import {
  LocalApiProvider,
  type LocalApiLimits,
  type LocalApiProviderOptions,
} from '../../src/provider-local.js'
import { parseRef } from '../../src/refs.js'
import type {
  ZoteroExportRequest,
  ZoteroGetRequest,
  ZoteroRetrieveRequest,
  ZoteroSearchRequest,
} from '../../src/types.js'
import { MockZotero } from './mock-zotero.js'

/** The limits every provider spec starts from; specs override per test. */
const DEFAULT_PROVIDER_LIMITS: LocalApiLimits = {
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
}

/** A provider over the given mock server's base URL, with optional limit overrides. */
export function createProvider(
  mock: MockZotero,
  limits: Partial<LocalApiLimits> = {},
  options: LocalApiProviderOptions = {},
): LocalApiProvider {
  return new LocalApiProvider(
    new ZoteroHttpClient({ baseUrl: mock.baseUrl, timeoutMs: 5000, maxResponseBytes: 1024 * 1024 }),
    { ...DEFAULT_PROVIDER_LIMITS, ...limits },
    options,
  )
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

/** Assert a rejected promise carries a typed ZoteroError with the exact code. */
export async function zoteroError(
  promise: Promise<unknown>,
  code: string,
  messagePart?: string,
): Promise<ZoteroError> {
  let thrown: unknown
  try {
    await promise
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(ZoteroError)
  const zotero = thrown as ZoteroError
  expect(zotero.code).toBe(code)
  if (messagePart !== undefined) expect(zotero.message).toContain(messagePart)
  return zotero
}

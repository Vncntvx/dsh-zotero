/**
 * The transport constructors the suite builds by hand, with their standard
 * bounds in one place: a spec passes `baseUrl` plus only the values it means
 * to vary. The production half reads these same bounds from config; the
 * test-side defaults below are deliberately smaller than some production
 * ones (a 1 MiB response bound keeps byte-limit cases cheap).
 * @module tests/helpers/test-clients
 */

import { ZoteroHttpClient, type ZoteroHttpClientOptions } from '../../src/http-client.js'
import { ZoteroWriteHttpClient, type ZoteroWriteHttpClientOptions } from '../../src/write-http.js'

/** Per-request data deadline every spec starts from. */
const STANDARD_TIMEOUT_MS = 5000
/** Streamed response byte bound every spec starts from. */
const STANDARD_MAX_RESPONSE_BYTES = 1024 * 1024
/** Client-wide in-flight slot count every spec starts from. */
const STANDARD_MAX_IN_FLIGHT = 8
/** Authorization-dialog budget every write spec starts from. */
const STANDARD_AUTHORIZE_DEADLINE_MS = 120_000

/**
 * A data client over `baseUrl` with the suite's standard bounds.
 * @param baseUrl - the mock server's API root (a trailing slash is preserved).
 * @param overrides - the bounds this spec varies.
 * @returns the client.
 */
export function testHttpClient(
  baseUrl: string,
  overrides: Partial<Omit<ZoteroHttpClientOptions, 'baseUrl'>> = {},
): ZoteroHttpClient {
  return new ZoteroHttpClient({
    baseUrl,
    timeoutMs: STANDARD_TIMEOUT_MS,
    maxResponseBytes: STANDARD_MAX_RESPONSE_BYTES,
    maxInFlight: STANDARD_MAX_IN_FLIGHT,
    ...overrides,
  })
}

/**
 * A write client over `baseUrl` with the suite's standard bounds.
 * @param baseUrl - the mock server's API root (a trailing slash is preserved).
 * @param overrides - the bounds this spec varies.
 * @returns the client.
 */
export function testWriteClient(
  baseUrl: string,
  overrides: Partial<Omit<ZoteroWriteHttpClientOptions, 'baseUrl'>> = {},
): ZoteroWriteHttpClient {
  return new ZoteroWriteHttpClient({
    baseUrl,
    timeoutMs: STANDARD_TIMEOUT_MS,
    maxResponseBytes: STANDARD_MAX_RESPONSE_BYTES,
    authorizeDeadlineMs: STANDARD_AUTHORIZE_DEADLINE_MS,
    ...overrides,
  })
}

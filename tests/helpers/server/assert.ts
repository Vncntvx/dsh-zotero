/**
 * Assertions about what the plugin put on the wire.
 *
 * Every provider spec proves something about the requests it made — which
 * endpoints, in what order, with which headers — and each of them used to
 * spell that out as `.map((entry) => entry.pathname)` next to an inline
 * `toEqual`. Naming the assertions makes the intent readable at the call site
 * and keeps the two arms that legitimately interleave (a children walk and a
 * collections listing) distinct from the ones that must be ordered.
 * @module tests/helpers/server/assert
 */

import { expect } from 'vitest'
import { ZoteroError } from '../../../src/errors.js'
import type { MockZotero } from '../mock-zotero.js'

/** The pathname of every request the server saw, in arrival order. */
export function requestPaths(mock: MockZotero): string[] {
  return mock.requests.map((entry) => entry.pathname)
}

/**
 * Every request as `pathname` plus its query string when present. Child-object
 * specs distinguish the bare `/children` listing from
 * `/children?itemType=annotation`, which pathname-only assertions cannot.
 */
export function requestLines(mock: MockZotero): string[] {
  return mock.requests.map((entry) => {
    const query = entry.search.toString()
    return query === '' ? entry.pathname : `${entry.pathname}?${query}`
  })
}

/**
 * Assert the requests arrived at exactly these path+query lines, in order.
 * @param mock - the server that recorded the requests.
 * @param expected - the request lines, in order.
 */
export function expectRequestLines(mock: MockZotero, expected: readonly string[]): void {
  expect(requestLines(mock)).toEqual([...expected])
}

/**
 * Assert the requests are exactly this set of path+query lines, ignoring order.
 * Use where the domain fans out independent halves (direct children and the
 * annotation listing) and the API makes no arrival-order promise.
 */
export function expectRequestLinesAnyOrder(mock: MockZotero, expected: readonly string[]): void {
  expect([...requestLines(mock)].sort()).toEqual([...expected].sort())
}

/**
 * Assert the requests arrived at exactly these paths, in this order. Use it
 * where the order is part of the contract — a lazy read that must not fetch
 * children before the parent.
 * @param mock - the server that recorded the requests.
 * @param expected - the pathnames, in order.
 */
export function expectRequestPaths(mock: MockZotero, expected: readonly string[]): void {
  expect(requestPaths(mock)).toEqual([...expected])
}

/**
 * Assert the requests are exactly this set, ignoring arrival order. Use it
 * where the domain fans out and the API makes no promise about which arm
 * answers first — the plugin must not depend on that order, and a test that
 * asserted one would fail on a scheduling change that broke nothing.
 * @param mock - the server that recorded the requests.
 * @param expected - the pathnames, as a set.
 */
export function expectRequestPathsAnyOrder(mock: MockZotero, expected: readonly string[]): void {
  expect([...requestPaths(mock)].sort()).toEqual([...expected].sort())
}

/** Assert how many requests the server saw, for the calls that must not fan out. */
export function expectRequestCount(mock: MockZotero, count: number): void {
  expect(mock.requests).toHaveLength(count)
}

/** Assert every request carried this header with this value. */
export function expectHeaderOnEveryRequest(mock: MockZotero, name: string, value: string): void {
  expect(mock.requests.length).toBeGreaterThan(0)
  for (const request of mock.requests) expect(request.headers[name]).toBe(value)
}

/**
 * Assert a rejected promise carries a typed `ZoteroError` with the exact code,
 * and optionally that its model-facing message names the given text.
 *
 * The code is asserted with equality: a test that accepted any failure would
 * pass on the wrong one, which is the failure mode this helper exists to stop.
 * @param promise - the call expected to reject.
 * @param code - the exact error code the domain must report.
 * @param messagePart - text the model-facing message must contain.
 * @returns the typed error, for a caller that needs to inspect it further.
 */
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

/**
 * The session event types this plugin wrote before `56d800e` removed the
 * `/zotero` command and its event chain, and which every later build therefore
 * refuses to interpret unless they carry `ignorable: true`.
 *
 * The list is a fact about this plugin's own history, not a guess decoded from
 * an error message: `git show 56d800e^:src/session-events.ts` declares exactly
 * one `SessionEventMap` member, `zotero/status`, and no current module appends
 * session events. A repair may only ever name these types: the plugin never
 * rewrites an event whose meaning the harness owns.
 * @module dsh-zotero/remediation/session-events
 */

/** Event types this plugin persisted without the `ignorable` marker. */
export const RETIRED_SESSION_EVENT_TYPES: readonly string[] = Object.freeze(['zotero/status'])

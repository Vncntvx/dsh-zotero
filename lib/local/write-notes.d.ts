/**
 * Create and update Zotero note items.
 * @module dsh-zotero/local/write-notes
 */
import type { ZoteroCreateNoteCommittedOutcome, ZoteroCreateNoteRequest, ZoteroUpdateNoteRequest, ZoteroUpdateNoteResult } from '../types.js';
import type { WriteDomainDeps } from './write-deps.js';
export declare function createNote(deps: WriteDomainDeps, request: ZoteroCreateNoteRequest, signal?: AbortSignal): Promise<ZoteroCreateNoteCommittedOutcome>;
export declare function updateNote(deps: WriteDomainDeps, request: ZoteroUpdateNoteRequest, signal?: AbortSignal): Promise<ZoteroUpdateNoteResult>;
//# sourceMappingURL=write-notes.d.ts.map
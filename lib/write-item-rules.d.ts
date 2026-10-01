/**
 * The item-shape rules both ends of an item create or update enforce: the
 * tool end before the plan card, the domain end for any caller that reaches
 * the domain without that tool. One implementation per rule and one wording
 * per refusal — the two ends must never drift.
 * @module dsh-zotero/write-item-rules
 */
import { type ZoteroCreatableItemType, type ZoteroCreator, type ZoteroUpdatableItemField } from './types.js';
/** Refuse an item type outside the closed creation whitelist. */
export declare function requireCreatableItemType(value: string): ZoteroCreatableItemType;
/** Refuse an item create that carries neither a title nor a URL. */
export declare function requireTitleOrUrl(title: string, url: string): void;
/**
 * Validate one creator entry and shape its wire form: a blank `creatorType`
 * and an entry that names no usable name field are refusals; a non-empty
 * `name` wins over the `firstName`/`lastName` pair, and empty parts are
 * dropped instead of sent as blank strings.
 */
export declare function normalizeCreator(creator: ZoteroCreator, index: number): ZoteroCreator;
/** Refuse an update field outside the closed updatable set. */
export declare function requireUpdatableField(field: string): void;
/** Zotero's wire name for one updatable field (`doi` rides as `DOI`). */
export declare function wireFieldOf(field: ZoteroUpdatableItemField): string;
//# sourceMappingURL=write-item-rules.d.ts.map
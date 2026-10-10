/**
 * The `zotero_delete_library_tags` tool: delete tags library-wide. Names are
 * idempotent (unknown names are silently ignored); the delete carries the
 * library version of its preceding read, so a concurrent write fails it.
 * Irreversible. The plan card pages the whole tag listing first, so every
 * requested name is either proven with its item count or proven absent.
 * @module dsh-zotero/tools/delete-library-tags
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools';
import type { ZoteroService } from '../service.js';
declare const DELETE_LIBRARY_TAGS_PARAMETERS: {
    readonly tags: {
        readonly type: "array";
        readonly items: {
            readonly type: "string";
        };
        readonly required: true;
        readonly description: "Tag names to delete library-wide (1..writeListMaxItems). Unknown names are ignored; the delete is irreversible.";
    };
};
type DeleteLibraryTagsArgs = InferArgs<typeof DELETE_LIBRARY_TAGS_PARAMETERS>;
declare const DELETE_LIBRARY_TAGS_OUTPUT_SCHEMA: {
    readonly oneOf: readonly [{
        readonly type: "object";
        readonly additionalProperties: false;
        readonly properties: {
            readonly kind: {
                readonly type: "string";
                readonly enum: readonly ["declined"];
                readonly required: true;
            };
        };
    }, {
        readonly type: "object";
        readonly additionalProperties: false;
        readonly properties: {
            readonly kind: {
                readonly type: "string";
                readonly enum: readonly ["deleted"];
                readonly required: true;
            };
            readonly deletedTags: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
                readonly required: true;
            };
            readonly libraryVersion: {
                readonly type: "integer";
                readonly required: true;
            };
            readonly serverId: {
                readonly type: "string";
            };
        };
    }];
};
type DeleteLibraryTagsOutput = InferValue<typeof DELETE_LIBRARY_TAGS_OUTPUT_SCHEMA>;
/** The per-tag proven facts the plan card renders. */
export interface TagPreview {
    /** Item counts; a seen-but-uncounted tag maps to `undefined`, an unlisted name is absent. */
    counts?: ReadonlyMap<string, number | undefined>;
    /** Requested names the full listing does not carry; Zotero will skip them. */
    unknown?: readonly string[];
}
/**
 * The deterministic plan markdown the approval card renders. A tag is shown
 * with its item count when the listing proved one, as `unknown items` when
 * the listing carried the tag without a count, and, only after the whole
 * listing has been scanned, as a proven no-op under "Unmatched names".
 */
export declare function deleteLibraryTagsPlan(args: DeleteLibraryTagsArgs, preview?: TagPreview): string;
export declare function renderDeleteLibraryTags(_args: DeleteLibraryTagsArgs, value: DeleteLibraryTagsOutput): ContentBlock[];
export declare function registerDeleteLibraryTagsTool(ctx: Context, service: ZoteroService): () => void;
export {};
//# sourceMappingURL=delete-library-tags.d.ts.map
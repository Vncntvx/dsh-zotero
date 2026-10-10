/**
 * The `zotero_create_note` tool: create a research note in the personal
 * library, either standalone or a child note under a parent item, with tags,
 * collections, and source relations. The plan-review approval runs before
 * Zotero is contacted; the markdown body is converted to note HTML by the
 * write domain under the escape-unknown grammar.
 * @module dsh-zotero/tools/create-note
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools';
import type { ZoteroService } from '../service.js';
declare const CREATE_NOTE_PARAMETERS: {
    readonly parentItem: {
        readonly type: "string";
        readonly description: "A zotero://user/0/item/<KEY> ref the note attaches under as a child note; omit for a standalone note. A child note inherits its parent's collections. Provide metadata fields (parentItem, collections, tags, sourceRefs) before markdown in the arguments.";
    };
    readonly collections: {
        readonly type: "array";
        readonly items: {
            readonly type: "string";
        };
        readonly description: "Collections the note joins, as zotero://user/0/collection/<KEY> refs or exact names. Standalone notes only; a child-note call that also passes non-empty collections is refused (they inherit the parent item's collections).";
    };
    readonly tags: {
        readonly type: "array";
        readonly items: {
            readonly type: "string";
        };
        readonly description: "Tags applied at creation.";
    };
    readonly sourceRefs: {
        readonly type: "array";
        readonly items: {
            readonly type: "string";
        };
        readonly description: "Item zotero://user/0/item/<KEY> refs the note derives from; recorded as dc:relation source links and echoed in the result.";
    };
    readonly markdown: {
        readonly type: "string";
        readonly required: true;
        readonly description: "The note body in markdown. Supported: paragraphs, # to #### headings, **bold**, *italic*, `code`, fenced code, > quotes, - and 1. lists (one nesting level), pipe tables with a |---| separator row, [text](https://… or zotero://…) links. Anything else is escaped and shown as literal text; raw HTML never passes through, so write markdown, not HTML.";
    };
};
type CreateNoteArgs = InferArgs<typeof CREATE_NOTE_PARAMETERS>;
declare const CREATE_NOTE_OUTPUT_SCHEMA: {
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
                readonly enum: readonly ["applied"];
                readonly required: true;
            };
            readonly ref: {
                readonly type: "string";
                readonly required: true;
                readonly description: "The created note ref (provenance-qualified).";
            };
            readonly key: {
                readonly type: "string";
                readonly required: true;
            };
            readonly version: {
                readonly type: "integer";
                readonly required: true;
            };
            readonly parentItem: {
                readonly type: "string";
                readonly description: "The parent ref, for a child note.";
            };
            readonly collections: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
                readonly required: true;
                readonly description: "Collections the note joined; empty for a child note.";
            };
            readonly tags: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
                readonly required: true;
            };
            readonly sourceRefs: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
                readonly required: true;
            };
            readonly libraryVersion: {
                readonly type: "integer";
                readonly required: true;
                readonly description: "The library version the write advanced to.";
            };
            readonly serverId: {
                readonly type: "string";
            };
        };
    }, {
        readonly type: "object";
        readonly additionalProperties: false;
        readonly properties: {
            readonly kind: {
                readonly type: "string";
                readonly enum: readonly ["committed-unverified"];
                readonly required: true;
            };
            readonly committed: {
                readonly type: "boolean";
                readonly enum: readonly [true];
                readonly required: true;
            };
            readonly retryable: {
                readonly type: "boolean";
                readonly enum: readonly [false];
                readonly required: true;
            };
            readonly reason: {
                readonly type: "string";
                readonly enum: readonly ["saved-state-unverified", "commit-unknown"];
                readonly required: true;
            };
            readonly ref: {
                readonly type: "string";
            };
            readonly key: {
                readonly type: "string";
            };
            readonly version: {
                readonly type: "integer";
            };
            readonly libraryVersion: {
                readonly type: "integer";
            };
            readonly serverId: {
                readonly type: "string";
                readonly required: true;
            };
        };
    }];
};
type CreateNoteOutput = InferValue<typeof CREATE_NOTE_OUTPUT_SCHEMA>;
/** The deterministic plan markdown the approval card renders. */
export declare function createNotePlan(args: CreateNoteArgs): string;
export declare function renderCreateNote(_args: CreateNoteArgs, value: CreateNoteOutput): ContentBlock[];
export declare function registerCreateNoteTool(ctx: Context, service: ZoteroService): () => void;
export {};
//# sourceMappingURL=create-note.d.ts.map
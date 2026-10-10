/**
 * The `zotero_delete_collection` tool: delete a collection by ref or exact
 * name. The plan card carries the blast radius first (item and subcollection
 * counts read before approval); the delete itself carries the library version
 * of its preceding read, so a concurrent write fails it. Entries keep their
 * items; child collections go with the parent.
 * @module dsh-zotero/tools/delete-collection
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools';
import type { ZoteroService } from '../service.js';
declare const DELETE_COLLECTION_PARAMETERS: {
    readonly collection: {
        readonly type: "string";
        readonly required: true;
        readonly description: "The collection to delete: a zotero://user/0/collection/<KEY> ref or an exact name (zotero_browse lists them). Items keep their library membership; child collections are deleted with the parent.";
    };
};
type DeleteCollectionArgs = InferArgs<typeof DELETE_COLLECTION_PARAMETERS>;
declare const DELETE_COLLECTION_OUTPUT_SCHEMA: {
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
            readonly ref: {
                readonly type: "string";
                readonly required: true;
            };
            readonly key: {
                readonly type: "string";
                readonly required: true;
            };
            readonly deleted: {
                readonly type: "boolean";
                readonly enum: readonly [true];
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
type DeleteCollectionOutput = InferValue<typeof DELETE_COLLECTION_OUTPUT_SCHEMA>;
/** The deterministic plan markdown the approval card renders, with the previewed radius. */
export declare function deleteCollectionPlan(args: DeleteCollectionArgs, preview?: {
    itemTotal?: number;
    childTotal?: number;
}): string;
export declare function renderDeleteCollection(_args: DeleteCollectionArgs, value: DeleteCollectionOutput): ContentBlock[];
export declare function registerDeleteCollectionTool(ctx: Context, service: ZoteroService): () => void;
export {};
//# sourceMappingURL=delete-collection.d.ts.map
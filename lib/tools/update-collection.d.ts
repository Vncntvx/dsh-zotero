import type { Context } from '@deepseek-ai/cordis';
import type { ZoteroService } from '../service.js';
export declare const PARAMETERS: {
    readonly collection: {
        readonly type: 'string';
        readonly required: true;
        readonly description: "A zotero://user/0/collection/<KEY> ref.";
    };
    readonly name: {
        readonly type: 'string';
        readonly description: 'The new non-blank collection name.';
    };
    readonly parent: {
        readonly type: 'string';
        readonly description: 'A collection ref; omit to preserve the current parent.';
    };
};
export declare function registerUpdateCollectionTool(ctx: Context, service: ZoteroService): () => void;
//# sourceMappingURL=update-collection.d.ts.map
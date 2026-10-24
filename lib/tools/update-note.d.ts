import type { Context } from '@deepseek-ai/cordis';
import { type InferArgs } from '@deepseek-ai/dsh-tools';
import type { ZoteroService } from '../service.js';
declare const PARAMETERS: {
    readonly ref: {
        readonly type: "string";
        readonly required: true;
        readonly description: "A zotero://user/0/item/<KEY> ref for an existing note.";
    };
    readonly markdown: {
        readonly type: "string";
        readonly required: true;
        readonly description: "The replacement note body in markdown.";
    };
};
type Args = InferArgs<typeof PARAMETERS>;
export declare function updateNotePlan(args: Args): string;
export declare function registerUpdateNoteTool(ctx: Context, service: ZoteroService): () => void;
export {};
//# sourceMappingURL=update-note.d.ts.map
import type { Context } from '@deepseek-ai/cordis';
import { type InferArgs } from '@deepseek-ai/dsh-tools';
import type { ZoteroService } from '../service.js';
declare const PARAMETERS: {
    readonly ref: {
        readonly type: 'string';
        readonly required: true;
        readonly description: "A zotero://user/0/item/<KEY> ref for an existing note.";
    };
    readonly markdown: {
        readonly type: 'string';
        readonly required: true;
        readonly description: "The note body in markdown: paragraphs, headings, **bold**, *italic*, `code`, fenced code, ==highlight==, $inline$ and $block$ math, > quotes, - and 1. lists (one level, incl. - [ ] tasks), pipe tables, [text](url) links. Anything else is escaped; raw HTML never passes.";
    };
};
type Args = InferArgs<typeof PARAMETERS>;
export declare function updateNotePlan(args: Args): string;
export declare function registerUpdateNoteTool(ctx: Context, service: ZoteroService): () => void;
export {};
//# sourceMappingURL=update-note.d.ts.map
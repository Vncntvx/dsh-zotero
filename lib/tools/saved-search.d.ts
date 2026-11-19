/**
 * The three saved-search write tools: create, update, and delete one saved
 * search through the write seam. The plan-review cards and the verdict
 * presentation are shared with the other write tools; this module owns only
 * the saved-search arguments and their validation.
 * @module dsh-zotero/tools/saved-search
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ZoteroService } from '../service.js';
declare const CREATE: {
    readonly name: {
        readonly type: 'string';
        readonly required: true;
    };
    readonly conditions: {
        readonly type: 'array';
        readonly required: true;
        readonly items: {
            readonly type: 'object';
            readonly additionalProperties: false;
            readonly properties: {
                readonly condition: {
                    readonly type: 'string';
                    readonly required: true;
                };
                readonly operator: {
                    readonly type: 'string';
                    readonly required: true;
                };
                readonly value: {
                    readonly type: 'string';
                    readonly required: true;
                };
            };
        };
    };
};
declare const UPDATE: {
    readonly search: {
        readonly type: 'string';
        readonly required: true;
        readonly description: "A zotero://user/0/search/<KEY> ref.";
    };
    readonly name: {
        readonly type: 'string';
    };
    readonly conditions: {
        readonly type: 'array';
        readonly items: {
            readonly type: 'object';
            readonly additionalProperties: false;
            readonly properties: {
                readonly condition: {
                    readonly type: 'string';
                    readonly required: true;
                };
                readonly operator: {
                    readonly type: 'string';
                    readonly required: true;
                };
                readonly value: {
                    readonly type: 'string';
                    readonly required: true;
                };
            };
        };
    };
};
declare const DELETE: {
    readonly search: {
        readonly type: 'string';
        readonly required: true;
        readonly description: "A zotero://user/0/search/<KEY> ref.";
    };
};
export declare function registerSavedSearchTools(ctx: Context, service: ZoteroService): Array<() => void>;
export { CREATE as CREATE_SEARCH_PARAMETERS, UPDATE as UPDATE_SEARCH_PARAMETERS, DELETE as DELETE_SEARCH_PARAMETERS, };
//# sourceMappingURL=saved-search.d.ts.map
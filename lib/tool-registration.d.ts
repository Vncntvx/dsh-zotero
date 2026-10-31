/**
 * @module dsh-zotero/tool-registration
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ZoteroService } from './service.js';
export declare function registerReadTools(ctx: Context, service: ZoteroService): void;
export declare function registerWriteTools(ctx: Context, service: ZoteroService): Array<() => void>;
//# sourceMappingURL=tool-registration.d.ts.map
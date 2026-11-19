/**
 * @module dsh-zotero/tool-registration
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ZoteroService } from './service.js';
import { ResultDelivery } from './result-delivery.js';
/** The live registrations of the two background-capable read tools. */
export interface ReadToolRegistration {
    /** Dispose their background-aware registrations (the fiber also owns them). */
    dispose(): void;
}
export declare function registerReadTools(ctx: Context, service: ZoteroService, delivery: ResultDelivery): ReadToolRegistration;
export declare function registerWriteTools(ctx: Context, service: ZoteroService): Array<() => void>;
//# sourceMappingURL=tool-registration.d.ts.map
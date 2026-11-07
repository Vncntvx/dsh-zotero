/** Authenticated, event-addressed reads; clients cannot supply paths or attachment IDs. */
import type { Context } from '@deepseek-ai/cordis';
import type { ResultDelivery } from './result-delivery.js';
export declare function readResult(ctx: Context, delivery: ResultDelivery, request: Request): Promise<Response>;
export declare function registerResultRoute(ctx: Context, delivery: ResultDelivery): void;
//# sourceMappingURL=result-route.d.ts.map
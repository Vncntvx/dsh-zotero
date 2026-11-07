/** Human panel mutations enter the registered tool pipeline and its service approval seam. */
import type { Context } from '@deepseek-ai/cordis';
import type { ZoteroLibraryWriteRequestView, ZoteroLibraryWriteResultView } from './contract.js';
export declare function executeLibraryWrite(ctx: Context, input: ZoteroLibraryWriteRequestView, signal: AbortSignal): Promise<ZoteroLibraryWriteResultView>;
//# sourceMappingURL=library-write.d.ts.map
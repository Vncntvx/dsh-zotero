/**
 * Barrel export creating all scholarly tools.
 * @module dsh-zotero/scholarly/tools/index
 */
import { createScholarlyCiteTool } from './cite.js';
import { createScholarlyCitationsTool } from './citations.js';
import { createScholarlyGetTool } from './get.js';
import { createScholarlyReadTool } from './read.js';
import { createScholarlySearchTool } from './search.js';
import { createScholarlyVerifyTool } from './verify.js';
import { createScholarlySaveToZoteroTool } from './save-to-zotero.js';
export * from './cite.js';
export * from './citations.js';
export * from './get.js';
export * from './read.js';
export * from './search.js';
export * from './verify.js';
export * from './save-to-zotero.js';
export function createAllScholarlyTools(host) {
    return [
        createScholarlySearchTool(host),
        createScholarlyGetTool(host),
        createScholarlyCitationsTool(host),
        createScholarlyReadTool(host),
        createScholarlyCiteTool(host),
        createScholarlyVerifyTool(host),
        createScholarlySaveToZoteroTool(host),
    ];
}
//# sourceMappingURL=index.js.map
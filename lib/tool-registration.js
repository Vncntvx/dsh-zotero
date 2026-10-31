/**
 * @module dsh-zotero/tool-registration
 */
import { registerAttachmentTool } from './tools/attachment.js';
import { registerBrowseTool } from './tools/browse.js';
import { registerChangesTool } from './tools/changes.js';
import { registerChildrenTool } from './tools/children.js';
import { registerExportTool } from './tools/export.js';
import { registerGetTool } from './tools/get.js';
import { registerRetrieveTool } from './tools/retrieve.js';
import { registerSearchTool } from './tools/search.js';
import { registerBatchItemsTool } from './tools/batch-items.js';
import { registerCreateCollectionTool } from './tools/create-collection.js';
import { registerCreateItemTool } from './tools/create-item.js';
import { registerCreateNoteTool } from './tools/create-note.js';
import { registerDeleteCollectionTool } from './tools/delete-collection.js';
import { registerDeleteLibraryTagsTool } from './tools/delete-library-tags.js';
import { registerRestoreItemsTool } from './tools/restore-items.js';
import { registerSavedSearchTools } from './tools/saved-search.js';
import { registerUpdateCollectionTool } from './tools/update-collection.js';
import { registerUpdateItemCollectionsTool } from './tools/update-item-collections.js';
import { registerUpdateItemTagsTool } from './tools/update-item-tags.js';
import { registerUpdateItemTool } from './tools/update-item.js';
import { registerUpdateNoteTool } from './tools/update-note.js';
export function registerReadTools(ctx, service) {
    registerSearchTool(ctx, service);
    registerGetTool(ctx, service);
    registerChildrenTool(ctx, service);
    registerAttachmentTool(ctx, service);
    registerRetrieveTool(ctx, service);
    registerBrowseTool(ctx, service);
    registerExportTool(ctx, service);
    registerChangesTool(ctx, service);
}
export function registerWriteTools(ctx, service) {
    return [
        registerCreateNoteTool(ctx, service),
        registerUpdateNoteTool(ctx, service),
        registerUpdateItemTagsTool(ctx, service),
        registerUpdateItemCollectionsTool(ctx, service),
        registerBatchItemsTool(ctx, service),
        registerCreateCollectionTool(ctx, service),
        registerUpdateCollectionTool(ctx, service),
        registerDeleteCollectionTool(ctx, service),
        registerCreateItemTool(ctx, service),
        registerUpdateItemTool(ctx, service),
        registerRestoreItemsTool(ctx, service),
        ...registerSavedSearchTools(ctx, service),
        registerDeleteLibraryTagsTool(ctx, service),
    ];
}
//# sourceMappingURL=tool-registration.js.map
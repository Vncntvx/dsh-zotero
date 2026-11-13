/**
 * @module dsh-zotero/tool-registration
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ZoteroService } from './service.js'
import { ResultDelivery, type ToolWrapper } from './result-delivery.js'
import { registerBrowseTool } from './tools/browse.js'
import { registerChangesTool } from './tools/changes.js'
import { registerExportTool } from './tools/export.js'
import { registerGetTool } from './tools/get.js'
import { registerGetBatchTool } from './tools/get-batch.js'
import { registerMatchReferencesTool } from './tools/match-references.js'
import { registerRetrieveTool } from './tools/retrieve.js'
import { registerSearchTool } from './tools/search.js'
import { registerBatchItemsTool } from './tools/batch-items.js'
import { registerCreateCollectionTool } from './tools/create-collection.js'
import { registerCreateItemTool } from './tools/create-item.js'
import { registerCreateNoteTool } from './tools/create-note.js'
import { registerDeleteCollectionTool } from './tools/delete-collection.js'
import { registerDeleteLibraryTagsTool } from './tools/delete-library-tags.js'
import { registerRestoreItemsTool } from './tools/restore-items.js'
import { registerSavedSearchTools } from './tools/saved-search.js'
import { registerUpdateCollectionTool } from './tools/update-collection.js'
import { registerUpdateItemCollectionsTool } from './tools/update-item-collections.js'
import { registerUpdateItemTagsTool } from './tools/update-item-tags.js'
import { registerUpdateItemTool } from './tools/update-item.js'
import { registerUpdateNoteTool } from './tools/update-note.js'

/** The live registrations of the two background-capable read tools. */
export interface ReadToolRegistration {
  /** Dispose their background-aware registrations (the fiber also owns them). */
  dispose(): void
}

export function registerReadTools(
  ctx: Context,
  service: ZoteroService,
  delivery: ResultDelivery,
): ReadToolRegistration {
  delivery.installJobs()
  // Every read tool registers through the same delivery envelope, explicitly:
  // the tool module still owns its schema and execute, and this is the one
  // place that wraps them.
  const wrap: ToolWrapper = (definition) => delivery.wrap(definition)
  registerSearchTool(ctx, service, wrap)
  registerGetTool(ctx, service, wrap)
  registerGetBatchTool(ctx, service, wrap)
  registerMatchReferencesTool(ctx, service, wrap)
  registerRetrieveTool(ctx, service, wrap)
  registerBrowseTool(ctx, service, wrap)
  // Both follow `enableRunInBackground` and the jobs service by themselves.
  const exportDispose = registerExportTool(ctx, service, wrap)
  const changesDispose = registerChangesTool(ctx, service, wrap)
  return {
    dispose: () => {
      exportDispose()
      changesDispose()
    },
  }
}

export function registerWriteTools(ctx: Context, service: ZoteroService): Array<() => void> {
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
  ]
}

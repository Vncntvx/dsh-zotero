/**
 * @module dsh-zotero/tool-registration
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ZoteroService } from './service.js'
import { registerResultRoute } from './result-route.js'
import { ResultDelivery } from './result-delivery.js'
import { registerBrowseTool } from './tools/browse.js'
import { registerChangesTool } from './tools/changes.js'
import { registerExportTool } from './tools/export.js'
import { registerGetTool } from './tools/get.js'
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

export function registerReadTools(ctx: Context, service: ZoteroService): void {
  const delivery = new ResultDelivery(ctx, () => service.config)
  delivery.installJobs()
  registerResultRoute(ctx, delivery)
  const tools = {
    register: (definition: Parameters<typeof ctx.tools.register>[0]) =>
      ctx.tools.register(delivery.wrap(definition)),
  }
  const readContext = new Proxy(ctx, {
    get(target, key) {
      return key === 'tools' ? tools : Reflect.get(target, key, target)
    },
  })
  registerSearchTool(readContext, service)
  registerGetTool(readContext, service)
  registerRetrieveTool(readContext, service)
  registerBrowseTool(readContext, service)
  registerExportTool(readContext, service, delivery)
  registerChangesTool(readContext, service, delivery)
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

/** `dsh-zotero/reader` optional component entry point. */

export { default, ReaderService } from './service.js'
export {
  ReaderConfigSchema,
  resolveReaderConfig,
  type ReaderConfig,
  type ResolvedReaderConfig,
} from './config.js'
export * from './identity.js'
export * from './evidence.js'
export * from './reading-state.js'

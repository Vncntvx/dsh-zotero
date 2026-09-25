/**
 * SlotMap augmentations for the Plugins page contributions.
 * @module dsh-zotero/client/plugin-slots.d.ts
 */

import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {
  PluginConfigViewProps,
  PluginDetailProps,
  ZoteroBundleQuickConfigFace,
  ZoteroDetailSectionFace,
} from './components/plugin/types.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'plugins.bundle.config': {
      kind: 'keyed'
      scope: 'root'
      owner: PluginConfigViewProps
      inject: ZoteroBundleQuickConfigFace
    }
    'plugins.detail.section': {
      kind: 'list'
      scope: 'root'
      owner: PluginDetailProps
      inject: ZoteroDetailSectionFace
    }
  }
}

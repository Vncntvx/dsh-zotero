/**
 * SlotMap augmentations for the Plugins page contributions and Chat tool views.
 * @module dsh-zotero/client/plugin-slots.d.ts
 */

import type { UseDisclosure, OpenFileOptions } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { MessageImageLoader } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  PreparingToolCall,
  StartedToolCall,
  ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  PluginActivationOwnerProps,
  PluginConfigViewProps,
  PluginDetailProps,
  ZoteroActivationGuideFace,
  ZoteroBundleQuickConfigFace,
  ZoteroDetailSectionFace,
} from './components/plugin/types.ts'

export interface ZoteroToolCallCommonProps {
  useDisclosure: UseDisclosure
  callId: string
  toolName: string
  cwd?: string | undefined
  home?: string | undefined
  openFile: (path: string, options?: OpenFileOptions) => void
  loadImage: MessageImageLoader
  inspect?: (() => void) | undefined
}

export type ZoteroToolCallPhaseProps =
  | { readonly phase: 'preparing'; readonly block: PreparingToolCall }
  | { readonly phase: 'start'; readonly block: StartedToolCall }
  | { readonly phase: 'result'; readonly block: ToolResultNode }

export type ZoteroToolCallOwnerProps = ZoteroToolCallCommonProps & ZoteroToolCallPhaseProps

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'plugins.bundle.activation': {
      kind: 'keyed'
      scope: 'root'
      owner: PluginActivationOwnerProps
      inject: ZoteroActivationGuideFace
    }
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
    /**
     * Chat tool view slot, keyed by model wire tool name (e.g. zotero_search).
     * Mirrored locally from `@deepseek-ai/dsh-client-ui-tool` to avoid pulling
     * in the full ui-tool package into devDependencies.
     */
    'tool.call.toolview': {
      kind: 'keyed'
      scope: 'session'
      owner: ZoteroToolCallOwnerProps
    }
  }
}

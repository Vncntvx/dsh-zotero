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
    /**
     * The three Plugins-page contributions below are mirrored with an extra
     * `inject` key that upstream does not declare
     * (`packages/client/ui-plugin-manager/src/client/slot-contract.ts`): the
     * runtime renderer supports an entry-level `inject` regardless, and these
     * three entries rely on it. Dropping the key here to match upstream
     * verbatim would break the activation guide, the quick config, and the
     * detail section, whose faces are passed through it.
     */
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
     *
     * Known drift, checked by hand on every harness bump: upstream
     * (`packages/client/ui-tool/src/client/contract/slots.ts`) also declares
     * `hookContext: ToolCallHookContext` and `inject: ToolCallInjected` on this
     * entry. Neither is mirrored, because no card in `src/client/toolviews`
     * binds a hook context or asks the framework for an injected face. If a
     * future card needs either, the mirror has to grow both keys together with
     * their upstream types — the omission is deliberate, not an oversight, and
     * an upstream change to this slot will not surface as a compile error here.
     */
    'tool.call.toolview': {
      kind: 'keyed'
      scope: 'session'
      owner: ZoteroToolCallOwnerProps
    }
  }
}

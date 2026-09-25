/**
 * Slot contracts for the Plugins page contributions.
 * @module dsh-zotero/client/components/plugin/types
 */

import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ZoteroStatusView } from '../../remote.ts'

export interface PluginConfigViewProps {
  readonly view: 'summary' | 'page'
  readonly form?: unknown
}

export interface PluginRowRef {
  readonly rowId: string
  readonly moduleName: string
  readonly enabled: boolean
}

export interface PluginPackageRef {
  readonly name: string
  readonly version?: string
  readonly installed: boolean
  readonly enabled: boolean
  readonly rows: readonly PluginRowRef[]
}

export type PluginsSubject =
  | { readonly kind: 'bundle'; readonly pkg: PluginPackageRef }
  | { readonly kind: 'row'; readonly pkg: PluginPackageRef; readonly row: PluginRowRef }
  | { readonly kind: 'item'; readonly id: string }

export interface PluginDetailProps {
  readonly subject: PluginsSubject
}

export interface ZoteroBundleQuickConfigFace {
  readonly form: ConfigForm<Record<string, unknown>>
  readonly t: TranslateNS<'zotero'>
}

export interface ZoteroDetailSectionFace {
  readonly t: TranslateNS<'zotero'>
  readonly probe: () => Promise<RemoteResult<ZoteroStatusView>>
}

/**
 * Slot contract wiring for the Plugins page contributions, Chat tool views,
 * the library item context menu, and the deliverables turn-data reader.
 *
 * The SlotMap rows themselves live upstream: the three `plugins.*` rows are
 * declared by `@deepseek-ai/dsh-client-ui-plugin-manager` (its client face
 * pulls in `slot-contract.ts`), `tool.call.toolview` by
 * `@deepseek-ai/dsh-client-ui-tool`, and the document-preview rows by
 * `@deepseek-ai/dsh-client-ui-sidebar-documentpreview`. These `import type {}`
 * statements only bring the upstream ambient declarations into the program:
 * contracts merge with `import type`, never with a runtime import
 * (slots.md:200).
 *
 * The `deliverables` turn-data key is declared locally in
 * `deliverables-turn-data.d.ts`: the upstream package's public `/client`
 * entry does not re-export its `ConversationTurnDataMap` augmentation, and
 * the source file that declares it is absent from the published tarball. No
 * import in this program may reach into an upstream package's private source
 * subtree; `npm run lint:test` enforces that boundary.
 *
 * @module dsh-zotero/client/plugin-slots.d.ts
 */

import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-deliverables/client'
import type {} from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Generated remote namespaces are published but not ambient: without this
// import `ctx.remote.credentials` is typed only when a sibling checkout leaks
// the settings-controller declaration into the program. A registry-only
// install must load it through the package's public `/remote` entry.
import type {} from '@deepseek-ai/dsh-api-settings-controller/remote'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import type { ZoteroClientFace } from './actions/client-face.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface GlobalStandardProps {
    /** The browser half's shared Remote face, provided once by the root fiber. */
    useZoteroClient: () => ZoteroClientFace
  }
}

declare module '@deepseek-ai/dsh-client-ui-context-menu/client' {
  interface ContextMenuTargetMap {
    zoteroItem: {
      readonly ref: string
      readonly title: string
      readonly itemType: string
    }
  }
}

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
 * The `turn-deliverables.ts` import is deliberately a type-only source import:
 * the package's public `/client` entry does not re-export the
 * `ConversationTurnDataMap` augmentation, and its published tarball ships no
 * `src/`. This declaration file is client typecheck input only; client types
 * are not emitted into `lib/`, so the published package never resolves it.
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
import type {} from '@deepseek-ai/dsh-client-ui-deliverables/src/client/turn-deliverables.ts'
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

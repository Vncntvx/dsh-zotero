/**
 * Slot contract wiring for the Plugins page contributions and Chat tool views.
 *
 * The SlotMap rows themselves live upstream: the three `plugins.*` rows are
 * declared by `@deepseek-ai/dsh-client-ui-plugin-manager` (its client face
 * pulls in `slot-contract.ts`) and `tool.call.toolview` by
 * `@deepseek-ai/dsh-client-ui-tool`. These `import type {}` statements only
 * bring the upstream ambient declarations into the program: contracts merge
 * with `import type`, never with a runtime import (slots.md:200).
 *
 * The renderer supports an entry-level `inject` on every slot regardless of
 * whether the SlotMap row declares one, so the registrants in
 * `src/client/index.ts` keep passing their inject factories without a local
 * mirror of the upstream rows.
 *
 * @module dsh-zotero/client/plugin-slots.d.ts
 */

import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'

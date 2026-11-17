/** The production menu registry and overlay mounted inside the public slot test runtime. */
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import * as menuPlugin from '@deepseek-ai/dsh-client-ui-context-menu/client'

export async function contextMenuRuntime() {
  const runtime = await SlotTestRuntime.create()
  const dictionaries = new Map<string, Record<string, Record<string, string>>>()
  runtime.ctx.provide('locale', {
    register: (name: string, dictionary: Record<string, Record<string, string>>) => {
      dictionaries.set(name, dictionary)
      return () => dictionaries.delete(name)
    },
    bind: (name: string) => (key: string) => dictionaries.get(name)?.en?.[key] ?? key,
  } as never)
  runtime.slots.installLocale({
    ...createSnapshotStore({ revision: 0 }),
    bind: (name: string) => ((key: string) => dictionaries.get(name)?.en?.[key] ?? key) as never,
  })
  runtime.ctx.provide('shortcuts', { catalog: createSnapshotStore([]) } as never)
  await runtime.declare({ 'shell.overlay': { kind: 'list', scope: 'root' } })
  await runtime.mount(menuPlugin)
  runtime.renderSlot('shell.overlay', {})
  return { runtime, menus: runtime.ctx.contextMenus, dispose: () => runtime.dispose() }
}

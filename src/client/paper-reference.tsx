/** Zotero references in the conversation and the composer. */
import type { Context } from '@deepseek-ai/cordis'
import type {
  UserTextNodeProps,
  UserTextRule,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { refFieldsOf, REF_PATTERN } from '../ref-grammar.js'
import { ZOTERO_REMOTE_PACKAGE } from '../contract.js'
import { selectUrlOf } from './actions/open-zotero.ts'

const SOURCE = 'dsh-zotero:paper'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap {
    zoteroPaper: { readonly ref: string; readonly label: string }
  }
}

export function zoteroRefsIn(text: string, from = 0) {
  const body = REF_PATTERN.source.slice(1, -1)
  const pattern = new RegExp(`${body}(?![A-Za-z0-9_/?=&-])`, 'gu')
  pattern.lastIndex = from
  const refs: { ref: string; key: string; start: number; end: number }[] = []
  for (let hit = pattern.exec(text); hit !== null; hit = pattern.exec(text)) {
    const ref = hit[0]
    const parsed = refFieldsOf(ref)
    if (parsed === undefined || !['item', 'attachment'].includes(parsed.kind)) continue
    if (parsed.libraryType === 'user' && parsed.libraryId !== '0') continue
    if (/\w/u.test(text.charAt(hit.index - 1))) continue
    refs.push({ ref, key: parsed.key, start: hit.index, end: hit.index + ref.length })
  }
  return refs
}

const paperRule: UserTextRule<'zoteroPaper'> = {
  id: 'zoteroPaper',
  order: 20,
  match(text, from) {
    const first = zoteroRefsIn(text, from)[0]
    return first === undefined
      ? undefined
      : {
          id: 'zoteroPaper',
          start: first.start,
          end: first.end,
          data: { ref: first.ref, label: first.key },
        }
  },
}

interface OpenZoteroRef {
  readonly openRef: (ref: string) => void
}
type Props = UserTextNodeProps<'zoteroPaper'> & PropsLocale<'zotero'> & InjectFace<OpenZoteroRef>

function PaperReference({ node, raw, interactive, openRef, t, useAccess }: Props) {
  const canRead = useAccess('zotero/item')
  const canOpen = useAccess('zotero/openProtocol')
  if (!interactive || !canRead || !canOpen) return <span>{raw}</span>
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => openRef(node.data.ref)}
      title={raw}
      aria-label={`${t('openInZotero')} ${node.data.label}`}
    >
      Zotero · {node.data.label}
    </Button>
  )
}

function paperSource(
  ctx: Context,
  openRef: OpenZoteroRef['openRef'],
  label: string,
): InputTriggerSource {
  return {
    trigger: '@',
    name: SOURCE,
    order: 20,
    candidates: async (_session, { query, signal }) => {
      const input = /^paper(?::(.*))?$/iu.exec(query)
      if (input === null) return []
      const result = await ctx.remote.zotero.search(
        {
          scope: { kind: 'library' },
          q: input[1],
          sort: 'title',
          direction: 'asc',
          offset: 0,
          limit: 12,
        },
        signal,
      )
      if (!result.ok) throw new Error(label)
      return result.value.items.flatMap((item) => {
        const ref = refFieldsOf(item.ref)
        if (ref?.kind !== 'item') return []
        return [
          {
            name: `paper:${ref.key}`,
            label: item.title,
            description: item.creatorSummary,
            value: item.ref,
          },
        ]
      })
    },
    codec: {
      clipboardText: (ref) => ref,
      async serialize(ref, signal) {
        if (refFieldsOf(ref)?.kind !== 'item') throw new Error(label)
        const result = await ctx.remote.zotero.item({ ref, include: [] }, signal)
        if (!result.ok || refFieldsOf(result.value.ref)?.kind !== 'item') throw new Error(label)
        return result.value.ref
      },
    },
    onPick({ candidate }) {
      const ref = candidate.value
      if (ref === undefined || refFieldsOf(ref)?.kind !== 'item') return undefined
      return {
        insert: {
          source: SOURCE,
          ref,
          label: candidate.label ?? candidate.name,
          clipboardText: ref,
        },
      }
    },
    openReference(_session, { ref }) {
      if (refFieldsOf(ref)?.kind !== 'item') return false
      openRef(ref)
      return true
    },
  }
}

export function registerPaperReferences(
  ctx: Context,
  open: (url: string) => Promise<boolean>,
  failed: () => void,
) {
  const t = ctx.locale.bind('zotero')
  const openRef = (ref: string) => {
    void (async () => {
      const result = await ctx.remote.zotero.item({ ref, include: [] })
      const url = result.ok ? selectUrlOf(result.value.ref) : null
      if (url === null) failed()
      else await open(url)
    })().catch(failed)
  }
  ctx.inject(['inputTriggers'], (scope) => {
    scope.effect(() =>
      scope.remoteAccess.whenAccess('zotero/search', () =>
        scope.remoteAccess.whenAccess('zotero/item', () =>
          scope.inputTriggers.registerSource(paperSource(scope, openRef, t('paperLookupFailed'))),
        ),
      ),
    )
  })
  ctx.inject(['uiConversation'], (scope) => {
    scope.effect(() => scope.uiConversation.userText.register(paperRule))
    scope.effect(() =>
      scope.slots.inject('conversation.user.text.node', () =>
        scope.slots.register(
          {
            name: 'conversation.user.text.node',
            key: 'zoteroPaper',
            locale: 'zotero',
            registrant: ZOTERO_REMOTE_PACKAGE,
            inject: () => ({ openRef }),
          },
          PaperReference,
        ),
      ),
    )
  })
  return openRef
}

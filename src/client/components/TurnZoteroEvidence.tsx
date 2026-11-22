/** Published tool evidence and explicit references in the finalized turn answer. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ChatSnapshot,
  ToolChatData,
  TurnTailChatData,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { artifactIdOf } from '../../contract.js'
import { refFieldsOf } from '../../ref-grammar.js'
import { evidenceItemsOf, metaOf, textArg } from '../../sources/presenters.js'
import { retrieveMetaOf } from '../../sources/decoders.js'
import { zoteroRefsIn } from '../paper-reference.tsx'

type Target = { readonly ref: string; readonly artifactId?: string }
type TurnEvidence = Target & { readonly referenced: boolean }

function evidenceRefs(call: ToolCallBlock, refs: Map<string, Target>): void {
  for (const nested of call.subCalls) evidenceRefs(nested, refs)
  if (
    !('isError' in call) ||
    call.isError ||
    !['zotero_retrieve', 'zotero_search_parsed'].includes(call.name)
  )
    return
  const meta = metaOf(call)
  if (meta === null) return
  if (call.name === 'zotero_search_parsed' && Array.isArray(meta.evidenceRefs)) {
    for (const ref of meta.evidenceRefs) {
      if (typeof ref !== 'string') continue
      if (refFieldsOf(ref) !== undefined) refs.set(ref, { ref })
      else if (artifactIdOf(ref) !== undefined) refs.set(ref, { ref, artifactId: ref })
    }
  }
  const retrieved = retrieveMetaOf(meta)
  if (retrieved.kind === 'fulltext') {
    const read = retrieved.fulltextRead
    const ref = read.item?.ref ?? read.attachmentRef
    if (ref !== undefined) refs.set(ref, { ref })
    else if (read.artifact !== undefined) {
      const artifactId = read.artifact.artifactId
      refs.set(artifactId, { ref: artifactId, artifactId })
    }
    return
  }
  const items = evidenceItemsOf(meta)
  if (items === null || items.length === 0) return
  const ref = call.name === 'zotero_retrieve' ? textArg(call.args, 'ref') : undefined
  if (ref !== undefined) refs.set(ref, { ref })
  for (const item of items) {
    const ref = refFieldsOf(item.sourceRef) === undefined ? item.attachmentRef : item.sourceRef
    if (ref !== undefined) refs.set(ref, { ref })
    else if (item.artifact !== undefined) {
      const artifactId = item.artifact.artifactId
      refs.set(artifactId, { ref: artifactId, artifactId })
    }
  }
}

export function turnZoteroEvidence(snapshot: ChatSnapshot, turn: number): TurnEvidence[] {
  const refs = new Map<string, Target>()
  let cited: string[] = []
  for (const key of snapshot.locations.getTurn(turn)) {
    const node = snapshot.nodes.get(key)
    if (node?.kind === 'tool-call') evidenceRefs((node.data as ToolChatData).root, refs)
    if (node?.kind === 'turn-tail') {
      const { closing } = node.data as TurnTailChatData
      cited =
        closing?.blocks.flatMap((block) =>
          block.kind === 'text'
            ? [
                ...zoteroRefsIn(block.text).map(({ ref }) => ref),
                ...Array.from(block.text.matchAll(/\b[a-f0-9]{64}\b/gu), ([id]) => id),
              ]
            : [],
        ) ?? []
    }
  }
  const explicit = new Set(cited)
  const qualifiedCounts = new Map<string, number>()
  for (const ref of refs.keys()) {
    const unqualified = ref.split('?')[0]!
    qualifiedCounts.set(unqualified, (qualifiedCounts.get(unqualified) ?? 0) + 1)
  }
  return [...refs.values()].map((target) => {
    const unqualified = target.ref.split('?')[0]!
    const unambiguous = qualifiedCounts.get(unqualified) === 1
    return {
      ...target,
      referenced: explicit.has(target.ref) || (unambiguous && explicit.has(unqualified)),
    }
  })
}

type Props = PropsRuntime<'conversation.chat.turnTail'> &
  PropsLocale<'zotero'> &
  InjectFace<{
    readonly openRef: (ref: string) => void
    readonly openParsed:
      ((sessionId: string, artifactId: string, title: string) => void) | undefined
  }>

export function TurnZoteroEvidence({
  useChat,
  turn,
  t,
  openRef,
  openParsed,
  sessionId,
  useAccess,
}: Props) {
  const canRead = useAccess('zotero/item')
  const canOpen = useAccess('zotero/openProtocol')
  const canReadArtifact = useAccess('zotero/documentArtifact')
  const refs = useChat(
    (snapshot) => turnZoteroEvidence(snapshot, turn.turn),
    (before, after) =>
      before.length === after.length &&
      before.every(
        (value, i) => value.ref === after[i]?.ref && value.referenced === after[i]?.referenced,
      ),
  )
  if (refs.length === 0) return null
  return (
    <details>
      <summary>
        {t('turnZoteroEvidence')} ({refs.length})
      </summary>
      <ul>
        {refs.map(({ ref, referenced, artifactId }) => {
          const key = artifactId === undefined ? refFieldsOf(ref)?.key : artifactId.slice(0, 12)
          const permitted =
            artifactId === undefined
              ? canRead && canOpen
              : canReadArtifact && openParsed !== undefined
          return key === undefined ? null : (
            <li key={ref}>
              {permitted ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    artifactId === undefined
                      ? openRef(ref)
                      : openParsed?.(sessionId, artifactId, key)
                  }
                  title={ref}
                >
                  {key}
                </Button>
              ) : (
                <span>{key}</span>
              )}{' '}
              {referenced ? t('turnZoteroReferenced') : t('turnZoteroRetrieved')}
            </li>
          )
        })}
      </ul>
    </details>
  )
}

/**
 * The item-level parse action, state-aware: one button that submits a parse
 * while no artifact exists and opens the committed artifact once one does. An
 * item carrying several PDFs asks which one first, then reports that
 * attachment's own state. The result opens as a right-sidebar tab, never as a
 * dialog or a row in the attachment list.
 * @module dsh-zotero/client/enrichment/ParsePdfAction
 */
import { useEffect, useRef, useState } from 'react'
import {
  Button,
  IconDeliverDocRegular,
  IconSparkleRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ZoteroAttachmentRowView,
  ZoteroDocumentArtifactRequestView,
  ZoteroDocumentArtifactResultView,
} from '../../contract.ts'
import { PdfPickerDialog } from '../components/PdfPickerDialog.tsx'

/** The metadata read, bound to one session by the composition root. */
export type ParsedArtifactReader = (
  request: ZoteroDocumentArtifactRequestView,
  signal?: AbortSignal,
) => Promise<RemoteResult<ZoteroDocumentArtifactResultView>>

export interface ParsePdfActionProps {
  readonly t: TranslateNS<'zotero'>
  readonly sessionId: string
  /** The item's PDF attachments, Zotero's best choice first. */
  readonly attachments: readonly ZoteroAttachmentRowView[]
  /** Absent without enrichment read access: the action stays a plain submit. */
  readonly read?: ParsedArtifactReader
  /** Bumped after a parse finishes so the probe re-reads the store. */
  readonly revision?: number
  /** Opens the submit form for one attachment. */
  readonly onParse: (attachment: ZoteroAttachmentRowView) => void
  /** Opens a committed artifact as its own right-sidebar tab. */
  readonly onOpenParsed?: (attachment: ZoteroAttachmentRowView) => void
}

/** One attachment's committed-artifact answer. */
type Probe = { readonly kind: 'ready' } | { readonly kind: 'absent' }

/**
 * One action, two states. The artifact probes are read-only metadata calls on
 * open; they never submit, resume, or upload anything.
 */
export function ParsePdfAction({
  t,
  sessionId,
  attachments,
  read,
  revision = 0,
  onParse,
  onOpenParsed,
}: ParsePdfActionProps) {
  const [probes, setProbes] = useState<ReadonlyMap<string, Probe>>()
  const [picking, setPicking] = useState(false)
  const epoch = useRef(0)
  const attachmentKey = attachments.map((attachment) => attachment.ref).join('\n')
  const primary = attachments[0]

  useEffect(() => {
    if (read === undefined) return setProbes(new Map())
    const current = ++epoch.current
    setProbes(undefined)
    const abort = new AbortController()
    void Promise.all(
      attachments.map(async (attachment): Promise<Probe> => {
        try {
          const result = await read(
            { sessionId, target: { kind: 'attachment', ref: attachment.ref } },
            abort.signal,
          )
          return result.ok && result.value.kind === 'ready' ? { kind: 'ready' } : { kind: 'absent' }
        } catch {
          // An unreadable probe is absence, never an error banner beside
          // "Read PDF": the action stays available as a submit.
          return { kind: 'absent' }
        }
      }),
    ).then((answers) => {
      if (current !== epoch.current) return
      setProbes(new Map(attachments.map((attachment, index) => [attachment.ref, answers[index]!])))
    })
    return () => {
      epoch.current++
      abort.abort()
    }
    // `attachmentKey` stands in for the array identity the wire compares.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read, sessionId, attachmentKey, revision])

  if (primary === undefined) return null
  const ready = attachments.some((attachment) => probes?.get(attachment.ref)?.kind === 'ready')
  const only = attachments.length === 1
  const open = () => {
    // A single PDF acts directly; several ask which one, in the same shape the
    // read action uses, because the state differs per attachment.
    if (!only) return setPicking(true)
    if (ready && onOpenParsed !== undefined) return onOpenParsed(primary)
    onParse(primary)
  }

  return (
    <>
      {/* The host's only high-contrast filled family. "Read PDF" beside it is
       * the same family, so the two stay distinguishable without inventing
       * colours. */}
      <Button
        variant="primary"
        size="sm"
        icon={ready ? <IconDeliverDocRegular size={14} /> : <IconSparkleRegular size={14} />}
        disabled={probes === undefined}
        aria-label={
          only
            ? t(ready ? 'libraryParsedResultNamed' : 'libraryParsePdfNamed', {
                title: primary.title,
              })
            : undefined
        }
        onClick={open}
      >
        {t(ready ? 'libraryParsedView' : only ? 'libraryParsePdf' : 'libraryParsePdfAny')}
      </Button>
      {!only && (
        <PdfPickerDialog
          open={picking}
          onClose={() => setPicking(false)}
          t={t}
          title={t('libraryPickPdf')}
          options={attachments.map((attachment) => {
            const parsed = probes?.get(attachment.ref)?.kind === 'ready'
            return {
              key: attachment.ref,
              title: attachment.title,
              action: t(parsed ? 'libraryParsedView' : 'libraryParsePdfAny'),
              onSelect: () => {
                setPicking(false)
                if (parsed && onOpenParsed !== undefined) onOpenParsed(attachment)
                else onParse(attachment)
              },
            }
          })}
        />
      )}
    </>
  )
}

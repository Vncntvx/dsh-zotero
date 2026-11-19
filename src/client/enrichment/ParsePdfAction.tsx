/**
 * The item-level parse action, state-aware: one command that submits a parse
 * while no artifact exists and opens the committed artifact once one does. An
 * item carrying several PDFs asks which one first, then reports that
 * attachment's own state. The result opens as a right-sidebar tab, never as a
 * dialog or a row in the attachment list.
 *
 * The probe state and the one command live in {@link useParsePdfAction}; the
 * button and its picker only render that state.
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
import type { ParsedDocuments } from '../parsed-documents.ts'
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
  /** Commit/discard invalidation from the parsed-document provider. */
  readonly documents?: ParsedDocuments
  /** Opens the submit form for one attachment. */
  readonly onParse: (attachment: ZoteroAttachmentRowView) => void
  /** Opens a committed artifact as its own right-sidebar tab. */
  readonly onOpenParsed?: (attachment: ZoteroAttachmentRowView) => void
}

/** One attachment's committed-artifact answer. */
type Probe = { readonly kind: 'ready' } | { readonly kind: 'absent' }

/** The live command one parse action exposes to its button and picker. */
export interface ParsePdfActionState {
  readonly primary: ZoteroAttachmentRowView | undefined
  readonly ready: boolean
  readonly only: boolean
  readonly disabled: boolean
  readonly label: string
  readonly ariaLabel: string | undefined
  readonly picking: boolean
  readonly attachments: readonly ZoteroAttachmentRowView[]
  readonly probes: ReadonlyMap<string, Probe> | undefined
  readonly open: () => void
  readonly closePicker: () => void
  readonly select: (attachment: ZoteroAttachmentRowView) => void
}

/**
 * Track the per-attachment artifact state and expose the one command the
 * action performs, so the button and the picker share one probe result.
 */
export function useParsePdfAction({
  t,
  sessionId,
  attachments,
  read,
  revision = 0,
  documents,
  onParse,
  onOpenParsed,
}: ParsePdfActionProps): ParsePdfActionState {
  const [probes, setProbes] = useState<ReadonlyMap<string, Probe>>()
  const [picking, setPicking] = useState(false)
  const [probeEpoch, setProbeEpoch] = useState(0)
  const epoch = useRef(0)
  const attachmentKey = attachments.map((attachment) => attachment.ref).join('\n')
  const primary = attachments[0]

  useEffect(() => {
    if (documents === undefined) return
    return documents.probeRevision.subscribe(() => setProbeEpoch((epoch) => epoch + 1))
  }, [documents])

  useEffect(() => {
    if (read === undefined) return setProbes(new Map())
    const current = ++epoch.current
    setProbes(undefined)
    const abort = new AbortController()
    void read({ sessionId, op: 'probe', refs: attachments.map((a) => a.ref) }, abort.signal)
      .then((result) => {
        if (current !== epoch.current || abort.signal.aborted) return
        // A failed batch is absence across the board, never an error banner
        // beside "Read PDF": the action stays available as a submit.
        const states = result.ok && result.value.kind === 'probed' ? result.value.results : []
        setProbes(
          new Map(
            attachments.map((attachment) => [
              attachment.ref,
              states.find((row) => row.ref === attachment.ref)?.state === 'ready'
                ? ({ kind: 'ready' } as Probe)
                : ({ kind: 'absent' } as Probe),
            ]),
          ),
        )
      })
      .catch(() => {
        if (current !== epoch.current || abort.signal.aborted) return
        setProbes(new Map(attachments.map((attachment) => [attachment.ref, { kind: 'absent' }])))
      })
    return () => {
      epoch.current += 1
      abort.abort()
    }
    // `attachmentKey` stands in for the array identity the wire compares.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read, sessionId, attachmentKey, revision, probeEpoch])

  const ready = attachments.some((attachment) => probes?.get(attachment.ref)?.kind === 'ready')
  const only = attachments.length === 1
  const open = () => {
    // A single PDF acts directly; several ask which one, in the same shape the
    // read action uses, because the state differs per attachment.
    if (primary === undefined) return
    if (!only) return setPicking(true)
    if (ready && onOpenParsed !== undefined) return onOpenParsed(primary)
    onParse(primary)
  }
  const select = (attachment: ZoteroAttachmentRowView) => {
    setPicking(false)
    const parsed = probes?.get(attachment.ref)?.kind === 'ready'
    if (parsed === true && onOpenParsed !== undefined) onOpenParsed(attachment)
    else onParse(attachment)
  }

  return {
    primary,
    ready,
    only,
    disabled: probes === undefined,
    label: t(ready ? 'libraryParsedView' : only ? 'libraryParsePdf' : 'libraryParsePdfAny'),
    ariaLabel:
      only && primary !== undefined
        ? t(ready ? 'libraryParsedResultNamed' : 'libraryParsePdfNamed', {
            title: primary.title,
          })
        : undefined,
    picking,
    attachments,
    probes,
    open,
    closePicker: () => setPicking(false),
    select,
  }
}

/** The chooser a multi-PDF command opens, shared by both renderings. */
function ParsePdfPicker({ state, t }: { state: ParsePdfActionState; t: TranslateNS<'zotero'> }) {
  if (state.only || state.primary === undefined) return null
  return (
    <PdfPickerDialog
      open={state.picking}
      onClose={state.closePicker}
      t={t}
      title={t('libraryPickPdf')}
      options={state.attachments.map((attachment) => {
        const parsed = state.probes?.get(attachment.ref)?.kind === 'ready'
        return {
          key: attachment.ref,
          title: attachment.title,
          action: t(parsed ? 'libraryParsedView' : 'libraryParsePdfAny'),
          onSelect: () => state.select(attachment),
        }
      })}
    />
  )
}

/**
 * One action, two states. Opening the action probes artifact metadata; the
 * probe is a read-only call.
 */
export function ParsePdfAction(props: ParsePdfActionProps) {
  const { t } = props
  const state = useParsePdfAction(props)
  if (state.primary === undefined) return null
  return (
    <>
      <Button
        variant="primary"
        size="sm"
        icon={state.ready ? <IconDeliverDocRegular size={14} /> : <IconSparkleRegular size={14} />}
        disabled={state.disabled}
        aria-label={state.ariaLabel}
        onClick={state.open}
      >
        {state.label}
      </Button>
      <ParsePdfPicker state={state} t={t} />
    </>
  )
}

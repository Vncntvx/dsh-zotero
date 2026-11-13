/**
 * The item's PDF actions: "Read PDF" and the parse action side by side in the
 * inspector head. An item with several PDFs asks which one first — the same
 * chooser serves both actions — while a single-PDF item keeps the direct
 * action and no dialog.
 * @module dsh-zotero/client/components/library/PdfActions
 */

import { useState } from 'react'
import { Button, IconDeliverDocRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroAttachmentLocationView, ZoteroAttachmentRowView } from '../../../contract.ts'
import { ParsePdfAction, type ParsedArtifactReader } from '../../enrichment/ParsePdfAction.tsx'
import { PdfPickerDialog } from '../PdfPickerDialog.tsx'
import { PdfReadButton } from '../open/PdfReadButton.tsx'

/** The parse face the composition root supplies when enrichment is enabled. */
export interface PdfParseFace {
  readonly sessionId: string
  readonly read?: ParsedArtifactReader
  /** Bumped when a parse finishes so the probes re-read the store. */
  readonly revision?: number
  readonly onParse: (attachment: ZoteroAttachmentRowView) => void
}

export interface PdfActionsProps {
  readonly t: TranslateNS<'zotero'>
  /** The item's PDF attachments, Zotero's best choice first. */
  readonly attachments: readonly ZoteroAttachmentRowView[]
  readonly readPdf?: (ref: string) => Promise<void>
  readonly openFile?: (path: string) => void
  readonly resolveAttachment?: (ref: string) => Promise<RemoteResult<ZoteroAttachmentLocationView>>
  readonly requireSessionForResolvedFile?: boolean
  readonly parse?: PdfParseFace
}

/** Render the item's PDF actions over the item's own PDF list. */
export function PdfActions({
  t,
  attachments,
  readPdf,
  openFile,
  resolveAttachment,
  requireSessionForResolvedFile = false,
  parse,
}: PdfActionsProps) {
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const primary = attachments[0]
  if (primary === undefined) return null

  const choose = async (ref: string) => {
    if (readPdf === undefined) return
    setBusy(true)
    setError(undefined)
    try {
      await readPdf(ref)
      setPicking(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {attachments.length === 1 ? (
        <PdfReadButton
          onReadAttachment={readPdf}
          attachmentRef={primary.ref}
          onOpenFile={openFile}
          resolveAttachment={resolveAttachment}
          requireSessionForResolvedFile={requireSessionForResolvedFile}
          emphasis="primary"
          t={t}
        />
      ) : (
        <Button
          variant="primary"
          size="sm"
          icon={<IconDeliverDocRegular size={14} />}
          disabled={readPdf === undefined}
          title={readPdf === undefined ? t('libraryNoSessionForOpen') : undefined}
          onClick={() => {
            setError(undefined)
            setPicking(true)
          }}
        >
          {t('readPdf')}
        </Button>
      )}
      {parse !== undefined && (
        <ParsePdfAction
          t={t}
          sessionId={parse.sessionId}
          attachments={attachments}
          read={parse.read}
          revision={parse.revision}
          onParse={parse.onParse}
        />
      )}
      {attachments.length > 1 && (
        <PdfPickerDialog
          open={picking}
          onClose={() => setPicking(false)}
          t={t}
          title={t('libraryPickPdfRead')}
          busy={busy}
          {...(error !== undefined ? { error } : {})}
          options={attachments.map((attachment) => ({
            key: attachment.ref,
            title: attachment.title,
            action: t('readPdf'),
            onSelect: () => void choose(attachment.ref),
          }))}
        />
      )}
    </>
  )
}

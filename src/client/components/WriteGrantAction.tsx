/**
 * The write-grant revocation row of the settings page: one action, one
 * explicit acknowledgement, and a live "is a grant stored" fact from the
 * status probe. Revocation deletes the plugin's credential record and clears
 * the in-memory key; Zotero's own copy of an Always-Allow key is untouched,
 * so the copy says the next write asks again rather than claiming a Zotero
 * change.
 * @module dsh-zotero/client/components/WriteGrantAction
 */

import { useState, type ReactNode } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { Button, RiskConfirmation } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ZoteroLocaleKey } from '../locales.ts'
import type { ZoteroStatusView, ZoteroWriteGrantRevokeView } from '../../contract.ts'
import { useZoteroProbe } from './useZoteroProbe.ts'
import css from '../fields.module.css'

/** What the row needs: locale copy and the two remote calls. */
interface WriteGrantActionProps {
  readonly t: (key: ZoteroLocaleKey) => string
  readonly probe: () => Promise<RemoteResult<ZoteroStatusView>>
  readonly revoke: () => Promise<RemoteResult<ZoteroWriteGrantRevokeView>>
}

/**
 * Render the revoke action only while a stored grant exists.
 * @param props - copy and the probe/revoke calls.
 * @returns the row, or null when writes are off or no grant is stored.
 */
export function WriteGrantAction({ t, probe, revoke }: WriteGrantActionProps): ReactNode {
  const { state, runProbe } = useZoteroProbe(probe, { initialAutoRun: true })
  const [confirming, setConfirming] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const write = state.data?.write
  if (write?.enabled !== true || write.authorized !== true) return null

  const confirm = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      const result = await revoke()
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setConfirming(false)
      setAcknowledged(false)
      await runProbe()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.field}>
      <div className={css.toggleRow}>
        <Button variant="outline" disabled={busy} onClick={() => setConfirming(true)}>
          {t('writeGrantRevoke')}
        </Button>
      </div>
      <p className={css.hint}>{t('writeGrantRevokeHint')}</p>
      {error !== undefined && <p className={css.hint}>{error}</p>}
      <RiskConfirmation
        open={confirming}
        title={t('writeGrantRevoke')}
        description={t('writeGrantRevokeConfirmHint')}
        acknowledgeLabel={t('writeGrantRevokeAcknowledge')}
        cancelLabel={t('writeRiskCancel')}
        closeLabel={t('writeRiskClose')}
        confirmLabel={t('writeGrantRevokeConfirm')}
        acknowledged={acknowledged}
        disabled={busy}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => {
          setConfirming(false)
          setAcknowledged(false)
        }}
        onConfirm={() => {
          void confirm()
        }}
      />
    </div>
  )
}

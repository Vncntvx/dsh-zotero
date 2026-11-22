import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from '../parsed-manager.module.css'

interface ParsedManagerDeleteDialogProps {
  pendingDelete?: { ids: readonly string[]; title?: string }
  busy: boolean
  onClose: () => void
  onConfirm: (ids: readonly string[]) => void
  t: TranslateNS<'zotero'>
}

export function ParsedManagerDeleteDialog(props: ParsedManagerDeleteDialogProps) {
  const { pendingDelete, busy, onClose, onConfirm, t } = props
  const batchConfirm = pendingDelete !== undefined && pendingDelete.ids.length > 1

  return (
    <Modal
      open={pendingDelete !== undefined}
      onClose={onClose}
      title={t(batchConfirm ? 'parsedManagerBatchDeleteTitle' : 'parsedManagerDeleteTitle', {
        count: pendingDelete?.ids.length ?? 0,
      })}
      description={t(
        batchConfirm ? 'parsedManagerBatchDeleteDescription' : 'parsedManagerDeleteDescription',
        { count: pendingDelete?.ids.length ?? 0, title: pendingDelete?.title ?? '' },
      )}
      closeLabel={t('parsedManagerDeleteCancel')}
      footer={
        // Deletion IDs are captured from the opening target.
        pendingDelete === undefined ? undefined : (
          <>
            <Button variant="outline" onClick={onClose}>
              {t('parsedManagerDeleteCancel')}
            </Button>
            <Button
              variant="outline"
              className={css.dangerAction}
              disabled={busy}
              onClick={() => {
                const ids = pendingDelete.ids
                onClose()
                onConfirm(ids)
              }}
            >
              {t('parsedManagerDeleteConfirm')}
            </Button>
          </>
        )
      }
    />
  )
}

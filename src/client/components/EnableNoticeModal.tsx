/**
 * The one modal a component's enable disclosure renders.
 *
 * Both component notices show the same shape — a title, the disclosure text, a
 * close affordance, and one confirming action — and differ only in copy, so
 * the shape lives here and each entry supplies its own text. The component
 * does not gate anything: the disclosure explains what enabling permits while
 * the authorization itself remains the component row's switch.
 * @module dsh-zotero/client/components/EnableNoticeModal
 */

import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './EnableNoticeModal.module.css'

/** Props of the disclosure modal. */
export interface EnableNoticeModalProps {
  /** Whether this client still owes the disclosure. */
  readonly open: boolean
  readonly title: string
  readonly description: string
  readonly confirmLabel: string
  /** Accept the disclosure: close the modal for this enable period. */
  readonly onDismiss: () => void
}

/**
 * Render the disclosure while this client has not acknowledged it.
 * @param props - the open state, the copy, and the dismissal.
 * @returns the modal, or nothing after dismissal.
 */
export function EnableNoticeModal({
  open,
  title,
  description,
  confirmLabel,
  onDismiss,
}: EnableNoticeModalProps): ReactNode {
  return (
    <Modal open={open} onClose={() => {}} title={title} headless>
      <div className={css.content}>
        <h2 className={css.title}>{title}</h2>
        <p className={css.description}>{description}</p>
        <div className={css.actions}>
          <Button variant="primary" onClick={onDismiss} data-modal-autofocus>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

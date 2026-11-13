/**
 * The choose-a-PDF dialog: a headless modal over one row per PDF attachment,
 * each row naming the action choosing it performs. The read action and the
 * parse action share it, so an item with several PDFs asks the same question
 * in the same place whichever action was pressed.
 * @module dsh-zotero/client/components/PdfPickerDialog
 */

import { useId } from 'react'
import { Button, IconCloseOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { IconButton } from './IconButton.tsx'
import css from './PdfPickerDialog.module.css'

/** One PDF the dialog offers, and what choosing it does. */
export interface PdfPickerOption {
  readonly key: string
  readonly title: string
  /** The trailing hint naming this row's action. */
  readonly action: string
  readonly onSelect: () => void
}

export interface PdfPickerDialogProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly t: TranslateNS<'zotero'>
  readonly title: string
  readonly options: readonly PdfPickerOption[]
  /** True while the chosen row's action still runs; every row waits. */
  readonly busy?: boolean
  /** A failed choice, kept beside the rows so another one stays available. */
  readonly error?: string
}

/** Render the chooser; the caller owns what each row does. */
export function PdfPickerDialog({
  open,
  onClose,
  t,
  title,
  options,
  busy = false,
  error,
}: PdfPickerDialogProps) {
  const titleId = useId()
  return (
    <Modal open={open} onClose={onClose} title={title} headless>
      <section className={css.dialog} aria-labelledby={titleId}>
        <header className={css.header}>
          <h2 id={titleId} className={css.title}>
            {title}
          </h2>
          <IconButton
            icon={<IconCloseOutlineRegular />}
            aria-label={t('parseClose')}
            onClick={onClose}
            type="button"
          />
        </header>
        {error !== undefined && (
          <p role="alert" className={css.error}>
            {error}
          </p>
        )}
        <ul className={css.list}>
          {options.map((option) => (
            <li key={option.key}>
              <Button
                variant="outline"
                size="sm"
                className={css.option}
                title={option.title}
                aria-label={`${option.title} ${option.action}`}
                disabled={busy}
                onClick={option.onSelect}
              >
                <span className={css.optionTitle}>{option.title}</span>
                <span className={css.optionAction}>{option.action}</span>
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </Modal>
  )
}

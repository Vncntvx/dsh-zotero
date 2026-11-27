import { useState } from 'react'
import { Button, Checkbox } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ZoteroAnnotationRowView,
  ZoteroReaderUpdateAnnotationRequest,
} from '../../contract.ts'
import { annotationColorOf } from './annotation-color.ts'
import css from './reader.module.css'

export function AnnotationEditor({
  row,
  t,
  busy,
  onSave,
  onClose,
}: PropsLocale<'zoteroReader'> & {
  row: ZoteroAnnotationRowView
  busy: boolean
  onSave: (
    changes: Pick<ZoteroReaderUpdateAnnotationRequest, 'set' | 'tagChanges'>,
  ) => Promise<void>
  onClose: () => void
}) {
  const initialColor = annotationColorOf(row.color)
  const initialComment = row.comment ?? ''
  const initialPage = row.pageLabel ?? ''
  const [removeTags, setRemoveTags] = useState<readonly string[]>([])
  return (
    <form
      aria-label={t('annotationEdit')}
      onKeyDown={(event) => {
        // An open native dropdown owns Escape; a second press leaves the form.
        if (event.key !== 'Escape' || event.target instanceof HTMLSelectElement) return
        event.preventDefault()
        onClose()
      }}
      onSubmit={(event) => {
        event.preventDefault()
        if (busy) return
        const form = new FormData(event.currentTarget)
        const type = form.get('type') === 'underline' ? 'underline' : 'highlight'
        const color = String(form.get('color') ?? initialColor)
        const comment = String(form.get('comment') ?? initialComment).trim()
        const page = String(form.get('page') ?? initialPage).trim()
        const set: ZoteroReaderUpdateAnnotationRequest['set'] = {
          ...(type === row.type ? {} : { annotationType: type }),
          ...(color === initialColor ? {} : { annotationColor: color }),
          ...(comment === initialComment ? {} : { annotationComment: comment }),
          ...(page === initialPage ? {} : { annotationPageLabel: page }),
        }
        const tag = String(form.get('addTag') ?? '').trim()
        const remove = removeTags
        const tagChanges = tag || remove.length ? { add: tag ? [tag] : [], remove } : undefined
        if (Object.keys(set).length === 0 && !tagChanges) onClose()
        else void onSave({ set, ...(tagChanges ? { tagChanges } : {}) })
      }}
    >
      <fieldset disabled={busy} className={`${css.fieldset} ${css.annotationEditor}`}>
        <label className={css.fieldLabel}>
          {t('annotationType')}
          <select className={css.field} name="type" defaultValue={row.type}>
            <option value="highlight">{t('highlight')}</option>
            <option value="underline">{t('underline')}</option>
          </select>
        </label>
        <label className={css.fieldLabel}>
          {t('annotationColor')}
          <input className={css.swatch} type="color" name="color" defaultValue={initialColor} />
        </label>
        <label className={css.fieldLabel}>
          {t('annotationPageLabel')}
          <input className={css.field} name="page" defaultValue={initialPage} />
        </label>
        <label className={css.fieldLabel}>
          {t('annotationComment')}
          <textarea className={css.field} name="comment" defaultValue={initialComment} />
        </label>
        {row.tags !== undefined && (
          <>
            <label className={css.fieldLabel}>
              {t('annotationAddTag')}
              <input className={css.field} name="addTag" />
            </label>
            {row.tags.length > 0 && (
              <fieldset className={css.fieldset}>
                <legend>{t('annotationRemoveTags')}</legend>
                {row.tags.map((tag) => (
                  <Checkbox
                    key={tag}
                    checked={removeTags.includes(tag)}
                    label={tag}
                    onChange={(next) =>
                      setRemoveTags((current) =>
                        next ? [...current, tag] : current.filter((item) => item !== tag),
                      )
                    }
                  />
                ))}
              </fieldset>
            )}
          </>
        )}
        <div className={css.controls}>
          <Button size="sm" variant="outline" type="button" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button size="sm" variant="primary" type="submit">
            {busy ? t('annotationSaving') : t('annotationSave')}
          </Button>
        </div>
      </fieldset>
    </form>
  )
}

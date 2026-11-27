// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AnnotationComment } from '../../../src/client/reader/AnnotationComment.tsx'
import { readerEn } from '../../../src/client/reader/locales.ts'
import { deferred } from '../../helpers/sync.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

const t = makeTranslate(readerEn)
afterEach(cleanup)

it('keeps a generated comment separate until accepted and allows editing before save', async () => {
  const suggest = vi.fn().mockResolvedValue('The treatment group was small.')
  const save = vi.fn()
  render(
    <form
      onSubmit={(event) => {
        event.preventDefault()
        save(new FormData(event.currentTarget).get('comment'))
      }}
    >
      <AnnotationComment t={t} signal={new AbortController().signal} suggest={suggest} />
      <button type="submit">Submit for review</button>
    </form>,
  )
  const comment = screen.getByRole<HTMLTextAreaElement>('textbox', {
    name: readerEn.annotationComment,
  })
  fireEvent.change(comment, { target: { value: 'My own comment' } })
  expect(suggest).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: readerEn.annotationSuggest }))
  const draft = await screen.findByRole('group', { name: readerEn.annotationSuggestion })
  expect(comment.value).toBe('My own comment')
  expect(save).not.toHaveBeenCalled()
  fireEvent.click(within(draft).getByRole('button', { name: readerEn.annotationDiscardSuggestion }))
  expect(comment.value).toBe('My own comment')
  fireEvent.click(screen.getByRole('button', { name: readerEn.annotationSuggest }))
  fireEvent.click(await screen.findByRole('button', { name: readerEn.annotationUseSuggestion }))
  expect(comment.value).toBe('The treatment group was small.')
  fireEvent.change(comment, { target: { value: 'The treatment group had eight participants.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))
  expect(save).toHaveBeenCalledExactlyOnceWith('The treatment group had eight participants.')
})

it('aborts a pending suggestion when the annotation draft closes', () => {
  const pending = deferred<string>()
  const suggest = vi.fn((_signal: AbortSignal) => pending.promise)
  const { unmount } = render(
    <AnnotationComment t={t} signal={new AbortController().signal} suggest={suggest} />,
  )
  fireEvent.click(screen.getByRole('button', { name: readerEn.annotationSuggest }))
  const signal = suggest.mock.calls[0]?.[0]
  expect(signal?.aborted).toBe(false)
  unmount()
  expect(signal?.aborted).toBe(true)
  pending.resolve('Discarded')
})

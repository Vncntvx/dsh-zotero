// @vitest-environment jsdom
/**
 * Test suite for the library write action drawer in the library panel.
 * @module tests/client/library/library-write
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LibraryWrite } from '../../../src/client/components/library/LibraryWrite.tsx'
import { zh } from '../../../src/client/locales.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'
import { deferred } from '../../helpers/sync.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const translate = makeTranslate(zh)

describe('LibraryWrite component', () => {
  it.each(['updateCollection', 'deleteCollection', 'updateSavedSearch', 'deleteSavedSearch'])(
    'anchors %s to the selected scope without needing a manually entered ref',
    async (operation) => {
      const write = vi
        .fn()
        .mockResolvedValue({ ok: true, value: { kind: 'applied', message: 'updated' } })
      const refresh = vi.fn()
      render(
        <LibraryWrite
          t={translate}
          write={write}
          sessionId="s1"
          sessionRunning
          collectionRef="zotero://user/0/collection/COLL0001"
          searchRef="zotero://user/0/search/SEARCH01"
          refreshAffected={refresh}
        />,
      )
      fireEvent.change(screen.getByLabelText(zh.libraryWriteOperation), {
        target: { value: operation },
      })
      if (operation.startsWith('update'))
        fireEvent.change(screen.getByLabelText(zh.libraryWriteName), {
          target: { value: 'Renamed' },
        })
      fireEvent.submit(document.querySelector('form')!)
      await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
      const args = operation.includes('Collection')
        ? { collection: 'zotero://user/0/collection/COLL0001' }
        : { search: 'zotero://user/0/search/SEARCH01' }
      expect(write).toHaveBeenCalledWith({
        sessionId: 's1',
        operation,
        args: { ...args, ...(operation.startsWith('update') ? { name: 'Renamed' } : {}) },
      })
      expect(refresh).toHaveBeenCalledWith(
        operation.includes('Collection') ? 'collections' : 'savedSearches',
      )
    },
  )

  it('does not submit without an active session and coalesces duplicate submissions while approval is pending', async () => {
    const pending = deferred<{ ok: true; value: { kind: 'applied'; message: string } }>()
    const write = vi.fn(() => pending.promise),
      refresh = vi.fn()
    const props = { t: translate, write, refreshAffected: refresh }
    const view = render(<LibraryWrite {...props} sessionId="s1" sessionRunning={false} />)
    fireEvent.submit(document.querySelector('form')!)
    expect(write).not.toHaveBeenCalled()
    view.rerender(<LibraryWrite {...props} sessionId="s1" sessionRunning />)
    fireEvent.change(screen.getByLabelText(zh.libraryWriteOperation), {
      target: { value: 'createCollection' },
    })
    fireEvent.change(screen.getByLabelText(zh.libraryWriteName), {
      target: { value: 'New collection' },
    })
    fireEvent.submit(document.querySelector('form')!)
    fireEvent.submit(document.querySelector('form')!)
    expect(write).toHaveBeenCalledTimes(1)
    view.unmount()
    await act(async () =>
      pending.resolve({ ok: true, value: { kind: 'applied', message: 'done' } }),
    )
    // The write committed even though the form was unmounted mid-approval:
    // the refresh runs against the feed regardless of this instance.
    expect(refresh).toHaveBeenCalledWith('collections')
  })

  it('submits a filled condition row and never the appended blank row', async () => {
    const write = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { kind: 'applied', message: 'created' } })
    render(
      <LibraryWrite
        t={translate}
        write={write}
        sessionId="s1"
        sessionRunning
        refreshAffected={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText(zh.libraryWriteOperation), {
      target: { value: 'createSavedSearch' },
    })
    fireEvent.change(screen.getByLabelText(zh.libraryWriteName), {
      target: { value: 'Unread' },
    })
    const condInput = screen.getAllByLabelText(zh.libraryWriteCondition)[0] as HTMLInputElement
    const opInput = screen.getAllByLabelText(zh.libraryWriteOperator)[0] as HTMLInputElement
    const valInput = screen.getAllByLabelText(zh.libraryWriteValue)[0] as HTMLInputElement
    fireEvent.change(condInput, { target: { value: 'title' } })
    fireEvent.change(opInput, { target: { value: 'contains' } })
    fireEvent.change(valInput, { target: { value: 'test' } })
    // The user adds a row and leaves it blank.
    fireEvent.click(screen.getByText(zh.libraryWriteAddCondition))
    fireEvent.submit(document.querySelector('form')!)
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    expect(write).toHaveBeenCalledWith({
      sessionId: 's1',
      operation: 'createSavedSearch',
      args: {
        name: 'Unread',
        conditions: [{ condition: 'title', operator: 'contains', value: 'test' }],
      },
    })
  })

  it('refuses an all-empty create and a partly filled row locally', async () => {
    const write = vi.fn()
    render(
      <LibraryWrite
        t={translate}
        write={write}
        sessionId="s1"
        sessionRunning
        refreshAffected={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText(zh.libraryWriteOperation), {
      target: { value: 'createSavedSearch' },
    })
    fireEvent.change(screen.getByLabelText(zh.libraryWriteName), {
      target: { value: 'Unread' },
    })
    fireEvent.submit(document.querySelector('form')!)
    await waitFor(() => expect(screen.getByText(zh.libraryWriteConditionsRequired)).toBeDefined())
    // A partly filled row is named, not silently dropped.
    const condInput = screen.getAllByLabelText(zh.libraryWriteCondition)[0] as HTMLInputElement
    fireEvent.change(condInput, { target: { value: 'title' } })
    fireEvent.submit(document.querySelector('form')!)
    await waitFor(() => expect(screen.getByText(zh.libraryWriteConditionIncomplete)).toBeDefined())
    expect(write).not.toHaveBeenCalled()
  })

  it('omits conditions on an all-empty update instead of sending them', async () => {
    const write = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { kind: 'applied', message: 'updated' } })
    render(
      <LibraryWrite
        t={translate}
        write={write}
        sessionId="s1"
        sessionRunning
        refreshAffected={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText(zh.libraryWriteOperation), {
      target: { value: 'updateSavedSearch' },
    })
    fireEvent.change(screen.getByLabelText(zh.libraryWriteSearch), {
      target: { value: 'zotero://user/0/search/S1' },
    })
    fireEvent.submit(document.querySelector('form')!)
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    expect(write).toHaveBeenCalledWith({
      sessionId: 's1',
      operation: 'updateSavedSearch',
      args: { search: 'zotero://user/0/search/S1' },
    })
  })
  it('renders the failure message when the write call rejects', async () => {
    const write = vi.fn().mockRejectedValue(new Error('loopback reset'))
    render(
      <LibraryWrite
        t={translate}
        write={write}
        sessionId="s1"
        sessionRunning
        refreshAffected={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText(zh.libraryWriteOperation), {
      target: { value: 'createCollection' },
    })
    fireEvent.change(screen.getByLabelText(zh.libraryWriteName), {
      target: { value: 'New collection' },
    })
    fireEvent.submit(document.querySelector('form')!)
    await waitFor(() => expect(screen.getByText('loopback reset')).toBeDefined())
  })

  it('submits edited item metadata and includes only nonempty set fields', async () => {
    const write = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { kind: 'applied', message: 'updated' } })
    render(
      <LibraryWrite
        t={translate}
        write={write}
        sessionId="s1"
        sessionRunning
        selectedRef="zotero://user/0/item/ITEM0001"
        refreshAffected={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText(zh.libraryWriteTitle), {
      target: { value: 'Updated paper' },
    })
    fireEvent.submit(document.querySelector('form')!)
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith({
        sessionId: 's1',
        operation: 'updateItem',
        args: { ref: 'zotero://user/0/item/ITEM0001', set: { title: 'Updated paper' } },
      }),
    )
  })

  it('renders closed summary and indicates when no running session is available', () => {
    const writeSpy = vi.fn()
    const appliedSpy = vi.fn()

    render(
      <LibraryWrite
        t={translate}
        write={writeSpy}
        sessionId="session-1"
        sessionRunning={false}
        refreshAffected={appliedSpy}
      />,
    )

    expect(screen.getByText(zh.libraryWriteActions)).toBeDefined()
    expect(screen.getByRole('status').textContent).toBe(zh.libraryWriteNeedsSession)
    const fieldset = document.querySelector('fieldset')
    expect(fieldset?.disabled).toBe(true)
  })

  it('binds the write target to the pane session and populates initial values from selectedRef', () => {
    const writeSpy = vi.fn()
    const appliedSpy = vi.fn()

    render(
      <LibraryWrite
        t={translate}
        write={writeSpy}
        sessionId="session-2"
        sessionRunning
        selectedRef="zotero://user/0/item/ITEMKEY1"
        collectionRef="zotero://user/0/collection/COLLKEY1"
        searchRef="zotero://user/0/savedSearch/SRCHKEY1"
        refreshAffected={appliedSpy}
      />,
    )

    // The write target is the pane's own conversation; there is no picker.
    const sessionInput = screen.getByLabelText(zh.libraryWriteSession) as HTMLInputElement
    expect(sessionInput.value).toBe('session-2')
    expect(sessionInput.readOnly).toBe(true)

    // Default operation is updateItem, which includes 'ref' populated from selectedRef
    const textareas = document.querySelectorAll('textarea')
    expect(textareas.length).toBeGreaterThan(0)
    expect(textareas[0]?.value).toBe('zotero://user/0/item/ITEMKEY1')
  })

  it('switches operations and manages conditions rows for createSavedSearch', () => {
    const writeSpy = vi.fn()
    const appliedSpy = vi.fn()

    render(
      <LibraryWrite
        t={translate}
        write={writeSpy}
        sessionId="session-1"
        sessionRunning
        refreshAffected={appliedSpy}
      />,
    )

    const opSelect = screen.getByLabelText(zh.libraryWriteOperation) as HTMLSelectElement
    fireEvent.change(opSelect, { target: { value: 'createSavedSearch' } })
    expect(opSelect.value).toBe('createSavedSearch')

    // Conditions row exists
    expect(screen.getByText(zh.libraryWriteAddCondition)).toBeDefined()
    const removeBtn = screen.getByText(zh.libraryWriteRemoveCondition) as HTMLButtonElement
    expect(removeBtn.disabled).toBe(true)

    // Add a condition
    fireEvent.click(screen.getByText(zh.libraryWriteAddCondition))
    const removeButtons = screen.getAllByText(zh.libraryWriteRemoveCondition)
    expect(removeButtons.length).toBe(2)
    expect((removeButtons[0] as HTMLButtonElement).disabled).toBe(false)

    const condInput = screen.getAllByLabelText(zh.libraryWriteCondition)[0] as HTMLInputElement
    const opInput = screen.getAllByLabelText(zh.libraryWriteOperator)[0] as HTMLInputElement
    const valInput = screen.getAllByLabelText(zh.libraryWriteValue)[0] as HTMLInputElement

    fireEvent.change(condInput, { target: { value: 'title' } })
    fireEvent.change(opInput, { target: { value: 'contains' } })
    fireEvent.change(valInput, { target: { value: 'test' } })

    // Remove the second condition
    fireEvent.click(removeButtons[1]!)
    expect(screen.getAllByText(zh.libraryWriteRemoveCondition).length).toBe(1)
  })

  it('shows validation failure message when submitted payload is invalid', async () => {
    const writeSpy = vi.fn()
    const appliedSpy = vi.fn()

    render(
      <LibraryWrite
        t={translate}
        write={writeSpy}
        sessionId="session-1"
        sessionRunning
        refreshAffected={appliedSpy}
      />,
    )

    // Submit without required fields
    const form = document.querySelector('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined()
      expect(screen.getByText(zh.libraryWriteFailed)).toBeDefined()
      expect(screen.getByText(zh.libraryWriteInvalid)).toBeDefined()
    })
    expect(writeSpy).not.toHaveBeenCalled()
  })

  it('submits valid createNote request, handles applied result and triggers callback', async () => {
    const writeSpy = vi.fn().mockResolvedValue({
      ok: true,
      value: { kind: 'applied', message: 'Note created successfully' },
    })
    const appliedSpy = vi.fn()

    render(
      <LibraryWrite
        t={translate}
        write={writeSpy}
        sessionId="session-1"
        sessionRunning
        selectedRef="zotero://user/0/item/PARENT123"
        refreshAffected={appliedSpy}
      />,
    )

    const opSelect = screen.getByLabelText(zh.libraryWriteOperation) as HTMLSelectElement
    fireEvent.change(opSelect, { target: { value: 'createNote' } })

    // Enter markdown body
    const markdownInput = document.querySelectorAll('textarea')[1]!
    fireEvent.change(markdownInput, { target: { value: 'My research note' } })

    // Enter tags (list field separated by newline)
    const tagsInput = document.querySelectorAll('textarea')[2]!
    fireEvent.change(tagsInput, { target: { value: 'tag1\ntag2' } })

    // Submit form
    const form = document.querySelector('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(writeSpy).toHaveBeenCalledWith({
        sessionId: 'session-1',
        operation: 'createNote',
        args: {
          parentItem: 'zotero://user/0/item/PARENT123',
          markdown: 'My research note',
          tags: ['tag1', 'tag2'],
        },
      })
      expect(screen.getByRole('status')).toBeDefined()
      expect(screen.getByText(zh.libraryWriteApplied)).toBeDefined()
      expect(screen.getByText('Note created successfully')).toBeDefined()
    })

    expect(appliedSpy).toHaveBeenCalledWith('items')
  })

  it('handles collection write submission and invokes applied("collections")', async () => {
    const writeSpy = vi.fn().mockResolvedValue({
      ok: true,
      value: { kind: 'applied', message: 'Collection created' },
    })
    const appliedSpy = vi.fn()

    render(
      <LibraryWrite
        t={translate}
        write={writeSpy}
        sessionId="session-1"
        sessionRunning
        refreshAffected={appliedSpy}
      />,
    )

    const opSelect = screen.getByLabelText(zh.libraryWriteOperation) as HTMLSelectElement
    fireEvent.change(opSelect, { target: { value: 'createCollection' } })

    const nameInput = document.querySelectorAll('textarea')[0]!
    fireEvent.change(nameInput, { target: { value: 'Deep Learning' } })

    const form = document.querySelector('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(writeSpy).toHaveBeenCalledWith({
        sessionId: 'session-1',
        operation: 'createCollection',
        args: {
          name: 'Deep Learning',
        },
      })
    })

    expect(appliedSpy).toHaveBeenCalledWith('collections')
  })

  it('handles declined, committed-unverified, and remote error write outcomes', async () => {
    const writeSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: { kind: 'declined', code: 'APPROVAL_DECLINED', message: 'User declined' },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          kind: 'committed-unverified',
          code: 'UNVERIFIED',
          message: 'Saved search unverified',
        },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { message: 'Network error communicating with Zotero' },
      })
      .mockRejectedValueOnce(new Error('Fatal remote crash'))

    const appliedSpy = vi.fn()

    render(
      <LibraryWrite
        t={translate}
        write={writeSpy}
        sessionId="session-1"
        sessionRunning
        refreshAffected={appliedSpy}
      />,
    )

    const opSelect = screen.getByLabelText(zh.libraryWriteOperation) as HTMLSelectElement
    fireEvent.change(opSelect, { target: { value: 'createCollection' } })
    const nameInput = document.querySelectorAll('textarea')[0]!
    fireEvent.change(nameInput, { target: { value: 'Col1' } })

    const form = document.querySelector('form')!

    // 1. Declined
    fireEvent.submit(form)
    await waitFor(() => {
      expect(screen.getByText(zh.libraryWriteDeclined)).toBeDefined()
      expect(screen.getByText(/APPROVAL_DECLINED/)).toBeDefined()
    })

    // 2. Committed unverified
    fireEvent.submit(form)
    await waitFor(() => {
      expect(screen.getByText(zh.libraryWriteUnverified)).toBeDefined()
      expect(screen.getByText(/Saved search unverified/)).toBeDefined()
    })

    // 3. ok: false error
    fireEvent.submit(form)
    await waitFor(() => {
      expect(screen.getByText(zh.libraryWriteFailed)).toBeDefined()
      expect(screen.getByText(/Network error communicating with Zotero/)).toBeDefined()
    })

    // 4. Exception rejected
    fireEvent.submit(form)
    await waitFor(() => {
      expect(screen.getByText(zh.libraryWriteFailed)).toBeDefined()
      expect(screen.getByText(/Fatal remote crash/)).toBeDefined()
    })
  })

  it('handles batch json field parsing and submission', async () => {
    const writeSpy = vi.fn().mockResolvedValue({
      ok: true,
      value: { kind: 'applied', message: 'Batch complete' },
    })
    const appliedSpy = vi.fn()

    render(
      <LibraryWrite
        t={translate}
        write={writeSpy}
        sessionId="session-1"
        sessionRunning
        refreshAffected={appliedSpy}
      />,
    )

    const opSelect = screen.getByLabelText(zh.libraryWriteOperation) as HTMLSelectElement
    fireEvent.change(opSelect, { target: { value: 'batch' } })

    // Batch has 'create' (json), 'update' (json), 'delete' (list)
    const textareas = document.querySelectorAll('textarea')
    const createJson = JSON.stringify([{ itemType: 'journalArticle', title: 'Paper 1' }])
    fireEvent.change(textareas[0]!, { target: { value: createJson } })
    fireEvent.change(textareas[2]!, { target: { value: 'ITEM1\nITEM2' } })

    const form = document.querySelector('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(writeSpy).toHaveBeenCalledWith({
        sessionId: 'session-1',
        operation: 'batch',
        args: {
          create: [{ itemType: 'journalArticle', title: 'Paper 1' }],
          delete: ['ITEM1', 'ITEM2'],
        },
      })
    })
  })
})

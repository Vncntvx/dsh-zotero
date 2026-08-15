/**
 * Staged-form behavior: edit/reset/save/discard, invalid drafts blocking the
 * save, writes landing only when the Host accepts them, and the clear gesture
 * re-inheriting the composition layer.
 * @module tests/client/card-form
 */

import { describe, expect, it } from 'vitest'
import {
  booleanField,
  CardForm,
  numberField,
  textField,
  type CardActions,
  type CardFieldSpec,
  type CardShell,
} from '../../src/client/card-form.ts'
import { fakeScope, type FakeScope } from './helpers/fake-scope.ts'

/** A ready scope whose user layer already overrides one field. */
function scopeWithLayers(overrides?: Partial<FakeScope>): FakeScope {
  return fakeScope({
    // The value layer is the RESOLVED section: user overrides the base, so
    // the override is what reads back (as the Host's schema resolution does).
    value: { baseUrl: 'http://127.0.0.1:23119/api', timeoutMs: 9000 },
    base: { baseUrl: 'http://127.0.0.1:23119/api', timeoutMs: 5000 },
    user: { timeoutMs: 9000 },
    ...overrides,
  })
}

function form(
  scope: FakeScope,
  specs: CardFieldSpec[] = [textField('baseUrl'), numberField('timeoutMs')],
) {
  const cardForm = new CardForm(scope, specs)
  const shell = (): CardShell => cardForm.shell()
  return { cardForm, shell }
}

describe('CardForm field specs', () => {
  it('textField formats strings and clears on an empty draft', () => {
    const spec = textField('x')
    expect(spec.format('abc')).toBe('abc')
    expect(spec.format(42)).toBe('')
    expect(spec.parse('  abc  ')).toEqual({ kind: 'set', value: 'abc' })
    expect(spec.parse('   ')).toEqual({ kind: 'clear' })
  })

  it('booleanField formats booleans and maps the literal drafts', () => {
    const spec = booleanField('webEnabled')
    expect(spec.format(true)).toBe('true')
    expect(spec.format(false)).toBe('false')
    expect(spec.format('junk')).toBe('')
    expect(spec.parse('true')).toEqual({ kind: 'set', value: true })
    expect(spec.parse('false')).toEqual({ kind: 'set', value: false })
    expect(spec.parse('  ')).toEqual({ kind: 'clear' })
    expect(spec.parse('yes')).toBeUndefined()
  })

  it('numberField formats numbers and rejects non-finite drafts', () => {
    const spec = numberField('x')
    expect(spec.format(5)).toBe('5')
    expect(spec.format('5')).toBe('')
    expect(spec.parse('42')).toEqual({ kind: 'set', value: 42 })
    expect(spec.parse('abc')).toBeUndefined()
    expect(spec.parse('')).toEqual({ kind: 'clear' })
  })
})

describe('CardForm reads', () => {
  it('seeds drafts from the resolved value and marks user-layer overrides', () => {
    const { cardForm } = form(scopeWithLayers())
    expect(cardForm.shell().available).toBe(true)
    expect(cardForm.field('baseUrl').text).toBe('http://127.0.0.1:23119/api')
    expect(cardForm.field('baseUrl').overridden).toBe(false)
    expect(cardForm.field('timeoutMs').text).toBe('9000')
    expect(cardForm.field('timeoutMs').overridden).toBe(true)
    expect(cardForm.shell().dirty).toBe(false)
  })

  it('reports unavailability from the scope status', () => {
    const { cardForm } = form(fakeScope({ status: 'unavailable' }))
    expect(cardForm.shell().available).toBe(false)
  })

  it('reports read-only documents', () => {
    const { cardForm } = form(fakeScope({ writable: false }))
    expect(cardForm.shell().writable).toBe(false)
  })

  it('throws on an undeclared field instead of degrading silently', () => {
    const { cardForm } = form(scopeWithLayers())
    expect(() => cardForm.field('nope')).toThrow(/no field nope/)
  })
})

describe('CardForm staging', () => {
  it('stages edits, marks the shell dirty, and clears on discard', () => {
    const scope = scopeWithLayers()
    const { cardForm, shell } = form(scope)
    const actions = cardForm.actions()
    actions.edit('baseUrl', 'http://localhost:23119/api')
    expect(shell().dirty).toBe(true)
    expect(cardForm.field('baseUrl').text).toBe('http://localhost:23119/api')
    actions.discard()
    expect(shell().dirty).toBe(false)
    expect(cardForm.field('baseUrl').text).toBe('http://127.0.0.1:23119/api')
  })

  it('discard with nothing staged is a no-op', () => {
    const scope = scopeWithLayers()
    const { cardForm, shell } = form(scope)
    const actions = cardForm.actions()
    actions.discard()
    expect(shell().dirty).toBe(false)
    expect(shell().failed).toBe(false)
    expect(scope.writes).toEqual([])
  })

  it('marks a non-numeric numeric draft invalid and blocks the save', async () => {
    const scope = scopeWithLayers()
    const { cardForm, shell } = form(scope)
    const actions = cardForm.actions()
    actions.edit('timeoutMs', 'soon')
    expect(cardForm.field('timeoutMs').invalid).toBe(true)
    expect(shell().invalid).toBe(true)
    await actions.save()
    expect(scope.writes).toEqual([])
    expect(shell().dirty).toBe(true)
  })

  it('stages a clear through resetField so saving re-inherits the base', async () => {
    const scope = scopeWithLayers()
    const { cardForm, shell } = form(scope)
    const actions = cardForm.actions()
    actions.resetField('timeoutMs')
    expect(cardForm.field('timeoutMs').text).toBe('5000')
    await actions.save()
    expect(scope.writes).toEqual([{ op: 'unset', field: 'timeoutMs' }])
    expect(shell().dirty).toBe(false)
    expect(cardForm.field('timeoutMs').overridden).toBe(false)
  })

  it('skips a staged edit that equals the effective value', async () => {
    const scope = fakeScope({ value: { timeoutMs: 5000 }, user: { timeoutMs: 5000 } })
    const { cardForm } = form(scope, [numberField('timeoutMs')])
    const actions = cardForm.actions()
    actions.edit('timeoutMs', '5000')
    await actions.save()
    expect(scope.writes).toEqual([])
  })

  it('drops a clear that has nothing to clear', async () => {
    const scope = scopeWithLayers()
    const { cardForm } = form(scope)
    const actions = cardForm.actions()
    actions.resetField('baseUrl')
    await actions.save()
    expect(scope.writes).toEqual([])
  })

  it('publishes projections to bound snapshot sources on scope changes', () => {
    const scope = scopeWithLayers()
    const { cardForm } = form(scope)
    const bound = cardForm.bind(() => cardForm.shell())
    const before = bound.getSnapshot()
    void scope.set('baseUrl', 'http://localhost:23119/api')
    expect(bound.getSnapshot()).not.toBe(before)
    const disposer = bound.subscribe(() => {})
    expect(typeof disposer).toBe('function')
  })
})

describe('CardForm save', () => {
  it('writes every staged edit and clears the drafts on success', async () => {
    const scope = scopeWithLayers()
    const { cardForm, shell } = form(scope)
    const actions = cardForm.actions()
    actions.edit('baseUrl', 'http://localhost:23119/api')
    actions.edit('timeoutMs', '3000')
    await actions.save()
    expect(scope.writes).toEqual([
      { op: 'set', field: 'baseUrl', value: 'http://localhost:23119/api' },
      { op: 'set', field: 'timeoutMs', value: 3000 },
    ])
    expect(shell().dirty).toBe(false)
    expect(cardForm.field('baseUrl').text).toBe('http://localhost:23119/api')
    expect(cardForm.field('timeoutMs').overridden).toBe(true)
  })

  it('keeps the drafts and reports failure when the Host rejects a write', async () => {
    const scope = fakeScope({ rejectWrites: true })
    const { cardForm, shell } = form(scope)
    const actions = cardForm.actions()
    actions.edit('baseUrl', 'http://localhost:23119/api')
    await actions.save()
    expect(shell().failed).toBe(true)
    expect(shell().dirty).toBe(true)
    expect(cardForm.field('baseUrl').text).toBe('http://localhost:23119/api')
    actions.discard()
    expect(shell().failed).toBe(false)
  })

  it('clears a text field when the draft is emptied', async () => {
    const scope = scopeWithLayers()
    const { cardForm } = form(scope)
    const actions = cardForm.actions()
    actions.edit('baseUrl', '')
    await actions.save()
    expect(scope.writes).toEqual([{ op: 'unset', field: 'baseUrl' }])
  })

  it('exposes the actions object shape a slot entry injects', () => {
    const { cardForm } = form(scopeWithLayers())
    const actions = cardForm.actions() as CardActions
    expect(Object.keys(actions).sort()).toEqual(['discard', 'edit', 'resetField', 'save'])
  })
})

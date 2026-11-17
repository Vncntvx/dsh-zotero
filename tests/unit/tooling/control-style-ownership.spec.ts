/** Ownership is determined from actual JSX imports and class bindings, including aliases. */
import { expect, it } from 'vitest'
import { controlStyleViolations } from '../../../scripts/shared/control-style-ownership.mjs'
const source = (code: string) => [{ file: 'src/client/View.tsx', code }]
const sheet = (css: string) => [{ file: 'src/client/view.module.css', css }]
const imports = `import { Button as Action } from '@deepseek-ai/dsh-client-ui-primitives'; import css from './view.module.css';`

it.each([
  'padding: 0',
  'height: auto',
  'background: var(--dsw-alias-bg-layer-1)',
  'color: inherit',
  'font: inherit',
  'border-radius: 8px',
])('rejects a feature-owned control declaration: %s', (declaration) => {
  const violations = controlStyleViolations(
    source(`${imports} const row = css['row']; const view = <Action className={row} />`),
    sheet(`.row.row:hover { ${declaration}; }`),
  )
  expect(violations).toHaveLength(1)
  expect(violations[0]?.detail).toContain('overrides host control design')
})

it('accepts layout on the control and design on its own content or frame', () => {
  expect(
    controlStyleViolations(
      source(
        `${imports} const view = <Action className={css.row}><span className={css.label} /></Action>`,
      ),
      sheet(
        '.row { display: flex; width: 100%; gap: 8px; text-align: left } .row > .label { padding: 4px; color: inherit } .frame { background: var(--dsw-alias-bg-layer-1) }',
      ),
    ),
  ).toEqual([])
})

it('rejects inline feature overrides while allowing the single intrinsic-height adapter contract', () => {
  expect(
    controlStyleViolations(
      source(`${imports} const view = <Action style={{ paddingInline: 0 }} />`),
      [],
    ),
  ).toHaveLength(1)
  const code = `import { Button } from '@deepseek-ai/dsh-client-ui-primitives'; const view = <Button style={{height: 'auto'}} />`
  expect(
    controlStyleViolations([{ file: 'src/client/components/ContentButton.tsx', code }], []),
  ).toEqual([])
  expect(
    controlStyleViolations(
      [{ file: 'src/client/components/ContentButton.tsx', code: code.replace("'auto'", '42') }],
      [],
    ),
  ).toHaveLength(1)
})

it('keeps geometry in the icon adapter but refuses host fill or typography overrides there', () => {
  const code = `import { Button } from '@deepseek-ai/dsh-client-ui-primitives'; import css from './IconButton.module.css'; const view = <Button className={css.icon} />`
  const scripts = [{ file: 'src/client/components/IconButton.tsx', code }]
  const styles = (css: string) => [{ file: 'src/client/components/IconButton.module.css', css }]
  expect(controlStyleViolations(scripts, styles('.icon { height: 28px; padding: 0 }'))).toEqual([])
  expect(
    controlStyleViolations(scripts, styles('.icon:hover { background: transparent }')),
  ).toHaveLength(1)
})

it('rejects a dynamic feature class whose control ownership cannot be established', () => {
  const violations = controlStyleViolations(
    source(`${imports} const view = <Action className={css[unknownState]} />`),
    sheet('.active { color: inherit }'),
  )
  expect(violations).toHaveLength(1)
  expect(violations[0]?.detail).toContain('statically verifiable')
})

/** Connect JSX control classes to their CSS rules instead of guessing by selector spelling. */
import { posix } from 'node:path'
import { sourceNodes } from './source-scan.mjs'
import { styleRules, styleDeclarations, selectorSubjects } from './css-syntax.mjs'

const ownsControlDesign = (property) =>
  /^(?:padding(?:-.+)?|(?:min-|max-)?height|(?:min-|max-)?block-size|background(?:-.+)?|color|font(?:-.+)?|line-height|border(?:-.+)?|outline(?:-.+)?|box-shadow|corner-shape)$/.test(
    property,
  )
const geometryAdapter = 'src/client/components/IconButton.module.css'
const contentAdapter = 'src/client/components/ContentButton.tsx'

export function controlStyleViolations(codeSources, styles) {
  const targets = new Map(),
    violations = []
  const add = (file, line, selector, detail) =>
    violations.push({
      file,
      line,
      selector,
      detail,
      fix: 'use the host control size/variant; place content layout or surface decoration on its own container',
    })
  for (const { file, code } of codeSources) {
    const nodes = sourceNodes(code),
      controls = new Set(),
      modules = new Map(),
      bindings = new Map()
    for (const { node } of nodes) {
      if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier')
        bindings.set(node.id.name, node.init)
      if (node.type !== 'ImportDeclaration') continue
      for (const spec of node.specifiers) {
        if (node.source.value.endsWith('.module.css'))
          modules.set(
            spec.local.name,
            posix.normalize(posix.join(posix.dirname(file), node.source.value)),
          )
        if (
          (node.source.value === '@deepseek-ai/dsh-client-ui-primitives' &&
            spec.imported?.name === 'Button') ||
          /\/(?:IconButton|ContentButton|ResponsiveActionButton)\.tsx$/.test(node.source.value)
        )
          controls.add(spec.local.name)
      }
    }
    const visit = (node, seen = new Set()) => {
      if (!node || typeof node !== 'object') return
      if (node.type === 'Identifier' && bindings.has(node.name) && !seen.has(node.name))
        visit(bindings.get(node.name), new Set([...seen, node.name]))
      if (node.type === 'MemberExpression' && modules.has(node.object?.name)) {
        const path = modules.get(node.object.name),
          names = targets.get(path) ?? new Set()
        const property =
          node.computed && node.property.type === 'Identifier'
            ? bindings.get(node.property.name)
            : node.property
        const name = node.computed ? property?.value : node.property.name
        if (typeof name === 'string') names.add(`.${name}`)
        else if (path === geometryAdapter) names.add('*')
        else
          add(
            file,
            node.loc.start.line,
            'className',
            'dynamic CSS module class has no statically verifiable control ownership',
          )
        targets.set(path, names)
      }
      for (const [key, value] of Object.entries(node)) {
        if (['loc', 'comments', 'tokens'].includes(key)) continue
        if (Array.isArray(value)) value.forEach((entry) => visit(entry, seen))
        else if (value && typeof value === 'object') visit(value, seen)
      }
    }
    for (const { node } of nodes) {
      if (node.type !== 'JSXOpeningElement' || !controls.has(node.name.name)) continue
      for (const attribute of node.attributes) {
        if (attribute.type !== 'JSXAttribute') continue
        if (attribute.name.name === 'className') visit(attribute.value?.expression)
        if (
          attribute.name.name !== 'style' ||
          attribute.value?.expression?.type !== 'ObjectExpression'
        )
          continue
        for (const property of attribute.value.expression.properties) {
          if (property.type !== 'ObjectProperty') continue
          const name = property.key.name ?? property.key.value
          const cssName = String(name).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
          if (!ownsControlDesign(cssName)) continue
          if (
            file === contentAdapter &&
            cssName === 'height' &&
            property.value.type === 'StringLiteral' &&
            property.value.value === 'auto'
          )
            continue
          add(
            file,
            property.loc.start.line,
            node.name.name,
            `inline ${cssName} overrides host control design`,
          )
        }
      }
    }
  }
  for (const { file, css } of styles) {
    const names = targets.get(file)
    if (!names) continue
    for (const rule of styleRules(css)) {
      if (!names.has('*') && !selectorSubjects(rule.selector).some((name) => names.has(name)))
        continue
      for (const declaration of styleDeclarations(rule.body)) {
        if (!ownsControlDesign(declaration.property)) continue
        if (
          file === geometryAdapter &&
          /^(?:padding(?:-.+)?|(?:min-|max-)?height|(?:min-|max-)?block-size|border(?:-[a-z]+)*-radius|corner-shape)$/.test(
            declaration.property,
          )
        )
          continue
        add(
          file,
          css.slice(0, rule.at).split('\n').length,
          rule.selector,
          `${declaration.property} overrides host control design`,
        )
      }
    }
  }
  return violations
}

/**
 * Research notes travel to Zotero as HTML — the note field is HTML, Zotero
 * performs no format conversion on writes, and markdown text stored verbatim
 * renders as raw markup (the failure mode community integrations hit). The
 * plugin therefore converts the model's markdown itself, under a restricted
 * grammar with one absolute rule: anything the grammar does not recognize is
 * HTML-escaped and shown as literal text. There is no raw-HTML passthrough,
 * no attribute inventing, and no scheme outside `https://`, `http://` and
 * `zotero://` can become a link — so a hostile or merely confused model
 * output degrades to visible text, never to markup.
 *
 * The grammar (documented for users in `docs/tools.md`):
 * - paragraphs: blank-line separated; soft-wrapped lines join with spaces;
 * - headings: ATX `#`–`####`; five or more hashes stay literal text;
 * - emphasis: `**bold**` and `*italic*`; `_underscore_` stays literal so
 *   identifiers like `max_export_refs` survive research notes;
 * - highlights: `==highlight==` mapped to `<mark>`;
 * - math: `$$` blocks mapped to `<math-display>` and `$math$` spans mapped to
 *   `<math-inline>` for native Zotero 7+ KaTeX rendering;
 * - code: `` `spans` `` and ``` fenced blocks; no formatting inside;
 * - links: `[text](url)` with `https://`, `http://` or `zotero://` URLs;
 *   other schemes render as literal text;
 * - lists: `-`/`*` bullets and `1.`/`1)` numbers, one nesting level;
 *   task list items `- [ ]` / `- [x]` map to `<ul class="task-list">` with
 *   `<li class="task-list-item"><input type="checkbox" ... />`;
 * - quotes: `>` lines, one paragraph per block;
 * - tables: pipe tables with a `---` separator row; without one, the lines
 *   stay literal paragraph text;
 * - rules: `---` / `***` on their own line.
 *
 * The output is the block sequence only: Zotero wraps saved notes in its own
 * schema-versioned envelope, so this module never emits one.
 * @module dsh-zotero/note-format
 */

/** Escape a text run so it can only ever render as text, never as markup. */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const INLINE_MATH_PATTERN =
  /(?<!\\|\$)\$(?!\s)((?:[^$\n\x00]|\\\$)+?)(?<!\\|\s)\$(?!\d|\$)/g
const HIGHLIGHT_PATTERN = /(?<!=)==(?!=|\s)((?:[^=\n]|=(?!=))+?)(?<!\s)==(?!=)/g
const CODE_RESTORE_PATTERN = /\x00CODE(\d+)\x00/g
const MATH_RESTORE_PATTERN = /\x00MATH(\d+)\x00/g

/**
 * Format inline text: extracts protected spans (inline code and inline math)
 * first so their delimiters and special characters (*, _, ==, <, >) are
 * immune to markdown markup, escapes remaining text, applies rich formatting,
 * and restores protected spans.
 */
function inlineFormatting(raw: string): string {
  const codeTokens: string[] = []
  let text = ''
  let rest = raw

  // 1. Extract inline code spans
  for (;;) {
    const open = rest.indexOf('`')
    if (open === -1) {
      text += rest
      break
    }
    const close = rest.indexOf('`', open + 1)
    if (close === -1) {
      text += rest
      break
    }
    text += rest.slice(0, open)
    const tokenIndex = codeTokens.length
    codeTokens.push(rest.slice(open + 1, close))
    text += `\x00CODE${tokenIndex}\x00`
    rest = rest.slice(close + 1)
  }

  // 2. Extract inline math spans ($...$)
  const mathTokens: string[] = []
  if (text.includes('$')) {
    text = text.replace(INLINE_MATH_PATTERN, (_, mathContent: string) => {
      const tokenIndex = mathTokens.length
      mathTokens.push(mathContent)
      return `\x00MATH${tokenIndex}\x00`
    })
  }

  // 3. Escape HTML of non-protected runs
  let formatted = escapeHtml(text)

  // 4. Inline rich markup
  formatted = highlight(formatted)
  formatted = bold(formatted)
  formatted = italic(formatted)
  formatted = linkify(formatted)

  // 5. Restore protected tokens (guarded against unnecessary global scans)
  if (codeTokens.length > 0) {
    formatted = formatted.replace(CODE_RESTORE_PATTERN, (_, indexStr: string) => {
      const idx = Number.parseInt(indexStr, 10)
      return `<code>${escapeHtml(codeTokens[idx] ?? '')}</code>`
    })
  }

  if (mathTokens.length > 0) {
    formatted = formatted.replace(MATH_RESTORE_PATTERN, (_, indexStr: string) => {
      const idx = Number.parseInt(indexStr, 10)
      return `<math-inline>${escapeHtml(mathTokens[idx] ?? '')}</math-inline>`
    })
  }

  return formatted
}

function highlight(escaped: string): string {
  return escaped.replace(HIGHLIGHT_PATTERN, '<mark>$1</mark>')
}

function bold(escaped: string): string {
  return escaped.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
}

function italic(escaped: string): string {
  return escaped.replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
}

/** Only the documented schemes become anchors; everything else stays literal. */
const LINK_PATTERN = /\[([^\]\n]*)\]\((https?:\/\/[^)\s]+|zotero:\/\/[^)\s]+)\)/g

function linkify(escaped: string): string {
  return escaped.replace(LINK_PATTERN, '<a href="$2">$1</a>')
}

const HEADING = /^(#{1,4})\s+(.*)$/
const FENCE_OPEN = /^```(.*)$/
const FENCE_CLOSE = /^```\s*$/
const MATH_BLOCK_OPEN = /^\s*\$\$(?!\$)(.*)$/
const QUOTE = /^>\s?/
const UNORDERED_ITEM = /^[-*]\s+/
const ORDERED_ITEM = /^\d+[.)]\s+/
const NESTED_ITEM = /^\s+([-*]|\d+[.)])\s+(.*)$/
const TASK_MARKER = /^\[([ xX])\]\s+(.*)$/
const RULE = /^\s*(-{3,}|\*{3,})\s*$/
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

function isBlockStart(line: string): boolean {
  return (
    HEADING.test(line) ||
    FENCE_OPEN.test(line) ||
    MATH_BLOCK_OPEN.test(line) ||
    QUOTE.test(line) ||
    UNORDERED_ITEM.test(line) ||
    ORDERED_ITEM.test(line) ||
    RULE.test(line)
  )
}

/** Split one table row into trimmed cells; no escaped pipes — document that. */
function tableCells(line: string): string[] {
  const trimmed = line.trim()
  const bare = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed
  const body = bare.endsWith('|') ? bare.slice(0, -1) : bare
  return body.split('|').map((cell) => cell.trim())
}

interface FormattedItem {
  isTask: boolean
  html: string
}

function formatListItem(rawText: string, subListHtml = '', trailingHtml = ''): FormattedItem {
  const taskMatch = TASK_MARKER.exec(rawText)
  if (taskMatch !== null) {
    const isChecked = taskMatch[1] === 'x' || taskMatch[1] === 'X'
    const body = taskMatch[2]
    const checkedAttr = isChecked ? ' checked=""' : ''
    const checkboxHtml = `<input type="checkbox"${checkedAttr} disabled="" /> `
    return {
      isTask: true,
      html: `<li class="task-list-item">${checkboxHtml}${inlineFormatting(body)}${subListHtml}${trailingHtml}</li>`,
    }
  }
  return {
    isTask: false,
    html: `<li>${inlineFormatting(rawText)}${subListHtml}${trailingHtml}</li>`,
  }
}

function renderList(ordered: boolean, hasTask: boolean, innerHtml: string): string {
  const tag = ordered ? 'ol' : 'ul'
  const listClass = hasTask ? ' class="task-list"' : ''
  return `<${tag}${listClass}>${innerHtml}</${tag}>`
}

/**
 * Convert research-note markdown to the HTML a Zotero note stores. Unknown
 * syntax never becomes markup: it is escaped and shown as written.
 */
export function markdownToNoteHtml(markdown: string): string {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')
  const blocks: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (line.trim() === '') {
      index += 1
      continue
    }

    const fence = FENCE_OPEN.exec(line)
    if (fence !== null) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !FENCE_CLOSE.test(lines[index])) {
        code.push(lines[index])
        index += 1
      }
      index += 1 // the closing fence, or the end of the input
      blocks.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }

    const mathBlock = MATH_BLOCK_OPEN.exec(line)
    if (mathBlock !== null) {
      const firstLineRest = mathBlock[1].trim()
      if (firstLineRest.endsWith('$$')) {
        const mathContent = firstLineRest.slice(0, -2).trim()
        blocks.push(`<math-display>${escapeHtml(mathContent)}</math-display>`)
        index += 1
        continue
      }
      const math: string[] = []
      if (firstLineRest !== '') {
        math.push(firstLineRest)
      }
      index += 1
      while (index < lines.length) {
        const curLine = lines[index]
        const trimmed = curLine.trim()
        if (trimmed === '$$') {
          index += 1
          break
        }
        if (trimmed.endsWith('$$')) {
          math.push(curLine.slice(0, curLine.lastIndexOf('$$')).trimEnd())
          index += 1
          break
        }
        math.push(curLine)
        index += 1
      }
      blocks.push(`<math-display>${escapeHtml(math.join('\n'))}</math-display>`)
      continue
    }

    const heading = HEADING.exec(line)
    if (heading !== null) {
      const level = heading[1].length
      blocks.push(`<h${level}>${inlineFormatting(heading[2])}</h${level}>`)
      index += 1
      continue
    }

    if (RULE.test(line)) {
      blocks.push('<hr/>')
      index += 1
      continue
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = []
      while (index < lines.length && QUOTE.test(lines[index])) {
        quoted.push(lines[index].replace(QUOTE, ''))
        index += 1
      }
      blocks.push(`<blockquote><p>${inlineFormatting(quoted.join(' '))}</p></blockquote>`)
      continue
    }

    const unordered = UNORDERED_ITEM.test(line)
    const ordered = ORDERED_ITEM.test(line)
    if (unordered || ordered) {
      const marker = unordered ? UNORDERED_ITEM : ORDERED_ITEM
      const items: string[] = []
      let hasTaskItem = false
      while (index < lines.length && marker.test(lines[index])) {
        let item = lines[index].replace(marker, '')
        index += 1
        const nested: Array<{ ordered: boolean; text: string }> = []
        const trailing: string[] = []
        for (;;) {
          if (index >= lines.length || lines[index].trim() === '' || !/^\s+\S/.test(lines[index])) {
            break
          }
          const nestedMatch = NESTED_ITEM.exec(lines[index])
          if (nestedMatch !== null && trailing.length === 0) {
            nested.push({ ordered: /\d/.test(nestedMatch[1]), text: nestedMatch[2] })
          } else if (nestedMatch !== null) {
            trailing.push(lines[index].trim())
          } else if (nested.length === 0) {
            item += ` ${lines[index].trim()}`
          } else {
            trailing.push(lines[index].trim())
          }
          index += 1
        }
        let subList = ''
        if (nested.length > 0) {
          const nestedItems = nested.map((n) => formatListItem(n.text))
          const nestedHasTask = nestedItems.some((n) => n.isTask)
          subList = renderList(
            nested[0].ordered,
            nestedHasTask,
            nestedItems.map((n) => n.html).join(''),
          )
        }
        const trailingHtml =
          trailing.length === 0 ? '' : `<p>${inlineFormatting(trailing.join(' '))}</p>`
        const itemResult = formatListItem(item, subList, trailingHtml)
        if (itemResult.isTask) hasTaskItem = true
        items.push(itemResult.html)
      }
      blocks.push(renderList(ordered, hasTaskItem, items.join('')))
      continue
    }

    // A pipe table needs its separator row; without one the lines are plain
    // paragraph text (escaped), never a malformed table.
    if (line.includes('|') && index + 1 < lines.length && TABLE_SEPARATOR.test(lines[index + 1])) {
      const head = tableCells(line)
      index += 2
      const rows: string[][] = []
      while (index < lines.length && lines[index].includes('|') && lines[index].trim() !== '') {
        rows.push(tableCells(lines[index]))
        index += 1
      }
      const headHtml = head.map((cell) => `<th>${inlineFormatting(cell)}</th>`).join('')
      const bodyHtml = rows
        .map((row) => {
          const cells = head.map((_, column) => row[column] ?? '')
          return `<tr>${cells.map((cell) => `<td>${inlineFormatting(cell)}</td>`).join('')}</tr>`
        })
        .join('')
      blocks.push(`<table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`)
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length && lines[index].trim() !== '' && !isBlockStart(lines[index])) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    blocks.push(`<p>${inlineFormatting(paragraph.join(' '))}</p>`)
  }

  return blocks.join('\n')
}

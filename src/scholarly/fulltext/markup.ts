/**
 * Markup converters for arXiv HTML (LaTeXML/ar5iv), JATS XML, and PDF.
 * Converts structured academic formats into plain Markdown with preserved headings and formulas.
 * @module dsh-zotero/scholarly/fulltext/markup
 */

import { decodeEntities } from '../sources/helpers.js'
export { decodeEntities }

function tidy(text: string): string {
  return decodeEntities(text.replace(/<[^>]+>/g, ''))
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const inlineText = (html: string): string =>
  decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Extracts and converts the <article> section of an arXiv HTML page to Markdown.
 */
export function arxivHtmlToMarkdown(html: string): string | undefined {
  const start = html.search(/<article[\s>]/i)
  const end = html.lastIndexOf('</article>')
  if (start === -1 || end <= start) return undefined

  let body = html
    .slice(start, end)
    .replace(/<(script|style|nav|button|svg)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<math\b([^>]*)>[\s\S]*?<\/math>/gi, (_all, attrs: string) => {
      const tex = /alttext="([^"]*)"/i.exec(attrs)?.[1]
      if (tex === undefined) return ''
      return /display="block"/i.test(attrs) ? `\n$$${tex}$$\n` : `$${tex}$`
    })
    .replace(
      /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_all, level: string, inner: string) =>
        `\n\n${'#'.repeat(Number(level))} ${inlineText(inner)}\n\n`,
    )
    .replace(
      /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/gi,
      (_all, inner: string) => `\n[${inlineText(inner)}]\n`,
    )
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<(br|\/p|\/div|\/section|\/li|\/table|\/figure|\/blockquote)\b[^>]*>/gi, '\n')

  body = tidy(body)
    .replace(/^[ |]*\|[ |]*$/gm, '')
    .replace(/ \|$/gm, '')
    .replace(/\n{3,}/g, '\n\n')

  return body.length < 500 ? undefined : body
}

/**
 * Converts a PubMed Central article (JATS XML) to Markdown.
 */
export function jatsToMarkdown(xml: string): string | undefined {
  const title = /<article-title\b[^>]*>([\s\S]*?)<\/article-title>/i.exec(xml)?.[1]
  const abstract = /<abstract\b[^>]*>([\s\S]*?)<\/abstract>/i.exec(xml)?.[1]
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(xml)?.[1]
  if (body === undefined) return undefined

  const references = /<ref-list\b[^>]*>([\s\S]*?)<\/ref-list>/i.exec(xml)?.[1]

  const block = (source: string, baseDepth: number): string => {
    let depth = baseDepth
    return source
      .replace(
        /<(tex-math)\b[^>]*>([\s\S]*?)<\/\1>/gi,
        (_all, _tag, tex: string) => ` $${tex.trim()}$ `,
      )
      .replace(/<(table-wrap|fig)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_all, _tag, inner: string) => {
        const label = /<label\b[^>]*>([\s\S]*?)<\/label>/i.exec(inner)?.[1] ?? ''
        const caption = /<caption\b[^>]*>([\s\S]*?)<\/caption>/i.exec(inner)?.[1] ?? ''
        const rows = inner
          .replace(/<caption\b[\s\S]*?<\/caption>/i, '')
          .replace(/<label\b[\s\S]*?<\/label>/i, '')
          .replace(/<\/t[dh]>/gi, ' | ')
          .replace(/<\/tr>/gi, '\n')
        return `\n[${inlineText(`${label} ${caption}`)}]\n${rows}\n`
      })
      .replace(
        /<sec\b[^>]*>|<\/sec>|<title\b[^>]*>([\s\S]*?)<\/title>/gi,
        (all, inner: string | undefined) => {
          if (/^<sec/i.test(all)) {
            depth++
            return '\n'
          }
          if (/^<\/sec/i.test(all)) {
            depth--
            return '\n'
          }
          return `\n\n${'#'.repeat(Math.min(6, Math.max(2, depth + 1)))} ${inlineText(inner ?? '')}\n\n`
        },
      )
      .replace(/<\/(p|list-item|ref)>/gi, '\n\n')
      .replace(/<list-item\b[^>]*>/gi, '- ')
  }

  const parts = [
    title === undefined ? '' : `# ${inlineText(title)}`,
    abstract === undefined ? '' : `## Abstract\n\n${tidy(block(abstract, 2))}`,
    tidy(block(body, 0)),
    references === undefined
      ? ''
      : `## References\n\n${tidy(block(references.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, ''), 1))}`,
  ].filter(Boolean)

  const text = parts.join('\n\n')
  return text.length < 500 ? undefined : text
}

/**
 * Extracts plain text from a PDF buffer using unpdf (pdf.js).
 *
 * Teardown is `loadingTask.destroy()`: that is the pdf.js API that releases
 * the worker and transport, and it is what unpdf itself calls. `PDFDocumentProxy`
 * has no `destroy` of its own — the earlier code called one that does not
 * exist and swallowed the resulting TypeError — and `cleanup()`, which does
 * exist, only releases page resources, which `destroy()` supersedes.
 *
 * @param data - the PDF bytes.
 * @returns one `[page n]` block per page.
 */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const proxy = await getDocumentProxy(data, { verbosity: 0 })
  try {
    const result = await extractText(proxy, { mergePages: false })
    const pages = result.text.map((pageText, idx) => `[page ${idx + 1}]\n${pageText.trim()}`)
    return pages.join('\n\n')
  } finally {
    await proxy.loadingTask.destroy()
  }
}

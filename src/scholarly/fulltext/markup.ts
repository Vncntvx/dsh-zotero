/**
 * Markup converters for arXiv HTML (LaTeXML/ar5iv), JATS XML, and PDF.
 * Converts structured academic formats into plain Markdown with preserved headings and formulas.
 * @module dsh-zotero/scholarly/fulltext/markup
 */

import { decodeEntities, plain } from '../sources/helpers.js'
import { academicHtml } from './html.js'

function tidy(text: string): string {
  return decodeEntities(text.replace(/<[^>]+>/g, ''))
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Extracts and converts the <article> section of an arXiv HTML page to Markdown.
 */
export function arxivHtmlToMarkdown(html: string): string | undefined {
  const body = academicHtml(html)
  return body === undefined || body.length < 500 ? undefined : body
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
        return `\n[${plain(`${label} ${caption}`)}]\n${rows}\n`
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
          return `\n\n${'#'.repeat(Math.min(6, Math.max(2, depth + 1)))} ${plain(inner ?? '')}\n\n`
        },
      )
      .replace(/<\/(p|list-item|ref)>/gi, '\n\n')
      .replace(/<list-item\b[^>]*>/gi, '- ')
  }

  const parts = [
    title === undefined ? '' : `# ${plain(title)}`,
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
 * Extract plain text from a PDF buffer, one `[page n]` block per page, through
 * unpdf (pdf.js).
 *
 * Teardown is `loadingTask.destroy()`: that is the pdf.js call that releases
 * the worker and transport, and it is what unpdf itself calls.
 * `PDFDocumentProxy` has no `destroy` of its own. `cleanup()` exists but only
 * releases page resources, which `destroy()` supersedes.
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

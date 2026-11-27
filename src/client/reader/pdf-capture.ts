import { AnnotationMode, type PDFDocumentProxy } from 'pdfjs-dist'
import type { PdfPageRegion, PdfRect } from '../../reader/evidence.ts'

export interface PdfCapture {
  readonly png: Blob
  readonly width: number
  readonly height: number
  readonly regions: readonly (PdfPageRegion & {
    readonly pageLabel: string
    readonly section?: string
  })[]
  readonly text: string
  readonly textIncomplete: boolean
}

interface CapturePage {
  readonly pageIndex: number
  readonly pageLabel: string
  readonly rotation: number
  readonly section?: string
  readonly textLayer?: Element | null
  /** Page interior in CSS pixels, excluding the viewer's decorative border. */
  readonly frame: PdfRect
}

const MAX_PIXELS = 4_000_000
const MAX_EDGE = 4096
const CAPTION_HEIGHT = 36
const MAX_TEXT_MEASUREMENTS = 12_000
const MAX_TEXT_LENGTH = 16_000

function intersection(left: PdfRect, right: PdfRect): PdfRect | undefined {
  const x = Math.max(left.x, right.x)
  const y = Math.max(left.y, right.y)
  const width = Math.min(left.x + left.width, right.x + right.width) - x
  const height = Math.min(left.y + left.height, right.y + right.height) - y
  return width > 0 && height > 0 ? { x, y, width, height } : undefined
}

function pngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Could not encode the PDF capture.'))
    }, 'image/png')
  })
}

function clipText(text: string, limit: number) {
  // Keep a UTF-16 limit without splitting a supplementary code point.
  const last = text.codePointAt(limit - 1)
  return text.slice(0, last !== undefined && last > 0xffff ? limit - 1 : limit)
}

/** Read the visible text layer in PDF order. For edge runs, keep glyphs whose centers are inside. */
function captureText(crops: readonly { page: CapturePage; crop: PdfRect }[]) {
  const parts: string[] = []
  const segmenter = new Intl.Segmenter()
  const range = document.createRange()
  let remaining = MAX_TEXT_MEASUREMENTS
  let incomplete = false
  let textLength = 0
  const append = (parts: string[], text: string) => {
    const available = MAX_TEXT_LENGTH - textLength
    if (text.length > available) incomplete = true
    const bounded = clipText(text, available)
    parts.push(bounded)
    textLength += bounded.length
  }
  for (const { page, crop } of crops) {
    if (!page.textLayer) {
      incomplete = true
      continue
    }
    const layer = page.textLayer
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
    const pageParts: string[] = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node instanceof HTMLBRElement) append(pageParts, '\n')
      if (!(node instanceof Text) || node.length === 0) continue
      if (--remaining < 0) break
      range.selectNodeContents(node)
      const box = range.getBoundingClientRect()
      if (!intersection(crop, box)) continue
      if (
        box.left >= crop.x &&
        box.top >= crop.y &&
        box.right <= crop.x + crop.width &&
        box.bottom <= crop.y + crop.height
      ) {
        append(pageParts, node.data)
        continue
      }
      for (const { segment, index } of segmenter.segment(node.data)) {
        if (--remaining < 0) break
        range.setStart(node, index)
        range.setEnd(node, index + segment.length)
        const glyph = range.getBoundingClientRect()
        const x = glyph.x + glyph.width / 2
        const y = glyph.y + glyph.height / 2
        if (x >= crop.x && x < crop.x + crop.width && y >= crop.y && y < crop.y + crop.height)
          append(pageParts, segment)
      }
      if (remaining < 0) break
    }
    const text = pageParts.join('').trim()
    if (text) parts.push(text)
    if (remaining < 0) {
      incomplete = true
      break
    }
  }
  const text = parts.join('\n\n')
  return {
    text: clipText(text, MAX_TEXT_LENGTH),
    textIncomplete: incomplete || text.length > MAX_TEXT_LENGTH,
  }
}

export async function capturePdfRegion(
  pdf: PDFDocumentProxy,
  pages: readonly CapturePage[],
  region: PdfRect,
  signal: AbortSignal,
  sourceTitle?: string,
): Promise<PdfCapture> {
  signal.throwIfAborted()
  const crops = pages.flatMap((page) => {
    const crop = intersection(page.frame, region)
    return crop ? [{ page, crop }] : []
  })
  if (crops.length === 0 || crops.length > 16) throw new Error('Choose a region over PDF pages.')
  const excerpt = captureText(crops)
  const left = Math.min(...crops.map(({ crop }) => crop.x))
  const width = Math.max(...crops.map(({ crop }) => crop.x + crop.width)) - left
  const height = crops.reduce((total, { crop }) => total + crop.height, 0)
  const footer = sourceTitle ? CAPTION_HEIGHT : 0
  const scale = Math.min(
    2,
    MAX_EDGE / width,
    (MAX_EDGE - footer) / height,
    Math.sqrt((MAX_PIXELS - MAX_EDGE * footer) / width / height),
  )
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(footer ? 240 : 1, Math.floor(width * scale))
  canvas.height = Math.max(1, Math.floor(height * scale)) + footer
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable.')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const regions: PdfCapture['regions'][number][] = []
  let top = 0
  try {
    for (const {
      page: { pageIndex, pageLabel, rotation, frame, section },
      crop,
    } of crops) {
      const page = await pdf.getPage(pageIndex + 1)
      signal.throwIfAborted()
      const unit = page.getViewport({ scale: 1, rotation })
      const viewport = page.getViewport({ scale: (frame.width * scale) / unit.width, rotation })
      const cropLeft = ((crop.x - frame.x) * viewport.width) / frame.width
      const cropTop = ((crop.y - frame.y) * viewport.height) / frame.height
      const cropRight = cropLeft + (crop.width * viewport.width) / frame.width
      const cropBottom = cropTop + (crop.height * viewport.height) / frame.height
      const first = viewport.convertToPdfPoint(cropLeft, cropTop)
      const last = viewport.convertToPdfPoint(cropRight, cropBottom)
      const [x1, y1] = first as [number, number]
      const [x2, y2] = last as [number, number]
      regions.push({
        pageIndex,
        pageLabel,
        ...(section ? { section } : {}),
        rects: [
          {
            x: Math.min(x1, x2),
            y: Math.min(y1, y2),
            width: Math.abs(x2 - x1),
            height: Math.abs(y2 - y1),
          },
        ],
      })

      const tile = document.createElement('canvas')
      tile.width = Math.max(1, Math.round(crop.width * scale))
      tile.height = Math.max(1, Math.round((top + crop.height) * scale) - Math.round(top * scale))
      const task = page.render({
        canvas: tile,
        viewport,
        transform: [1, 0, 0, 1, -cropLeft, -cropTop],
        annotationMode: AnnotationMode.DISABLE,
      })
      const cancel = () => task.cancel()
      signal.addEventListener('abort', cancel, { once: true })
      try {
        await task.promise
        signal.throwIfAborted()
        context.drawImage(tile, Math.round((crop.x - left) * scale), Math.round(top * scale))
      } finally {
        signal.removeEventListener('abort', cancel)
        tile.width = tile.height = 0
      }
      top += crop.height
    }
    if (sourceTitle) {
      const baseline = canvas.height - footer
      context.fillStyle = '#fff'
      context.fillRect(0, baseline, canvas.width, footer)
      context.fillStyle = '#222'
      context.font = '12px sans-serif'
      context.fillText(clipText(sourceTitle, 180), 8, baseline + 14, canvas.width - 16)
      const labels = regions.map(({ pageIndex, pageLabel }) =>
        pageLabel === String(pageIndex + 1) ? pageLabel : `${pageLabel} (${pageIndex + 1})`,
      )
      context.fillText(clipText(labels.join(' · '), 180), 8, baseline + 28, canvas.width - 16)
    }
    const png = await pngBlob(canvas)
    signal.throwIfAborted()
    return { png, width: canvas.width, height: canvas.height, regions, ...excerpt }
  } finally {
    canvas.width = canvas.height = 0
  }
}

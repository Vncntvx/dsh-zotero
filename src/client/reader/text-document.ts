import { HTML_CONTENT_TYPE } from '../../media-types.ts'

export const TEXT_ATTACHMENT_BYTES = 512 * 1024

export function readerTextFormat(contentType: string | undefined) {
  switch (contentType?.split(';', 1)[0]?.trim().toLowerCase()) {
    case HTML_CONTENT_TYPE:
    case 'application/xhtml+xml':
      return 'html'
    case 'text/markdown':
    case 'text/x-markdown':
      return 'markdown'
    case 'text/plain':
      return 'text'
  }
}

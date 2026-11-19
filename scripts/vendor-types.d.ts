/** JSDOM surface used by the bundle check. The upstream typings bring a separate Undici type tree. */
declare module 'jsdom' {
  /** The window surface the client bundle smoke reads and drives. */
  export interface JSDOMWindow {
    document: Document
    close(): void
    [key: string]: unknown
  }

  export class JSDOM {
    constructor(html: string, options?: Record<string, unknown>)
    readonly window: JSDOMWindow
  }
}

/** The Reader's shadow root rules, appended after the bundled PDF.js sheet. */
export declare const shadowTheme: string
/** Files the Reader PDF chunk adds to the published package. */
export declare const readerPdfPackPaths: readonly string[]
/** Build the PDF.js runtime as a Harness package-local browser chunk. */
export declare function buildReaderPdf(root: string, pluginId: string): Promise<void>

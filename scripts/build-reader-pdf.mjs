/** Build the PDF.js runtime as a Harness package-local browser chunk. */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import * as esbuild from 'esbuild'

const require = createRequire(import.meta.url)
const chunk = 'client.reader-pdf.js'
export const readerPdfPackPaths = [
  `lib/${chunk}`,
  'lib/reader-pdf.LICENSE',
  'lib/reader-pdf.NOTICE',
]

/**
 * Append the shadow root's own rules after the PDF.js sheet.
 *
 * PDF.js ships a palette of its own (`light-dark()`, `AccentColor`): the toolbar,
 * findbar, editor and sidebar never mount here, but text selection, find
 * matches, and annotation comment popups do, and they would paint OS or Firefox
 * colours beside `--dsw-*` chrome and ignore the host theme. `--dsw-*` inherits
 * through the shadow boundary, so these rules follow a theme switch.
 *
 * The same block owns the focus ring (a document-level `:focus-visible` rule
 * cannot cross the shadow boundary) and the annotation overlays the runtime
 * paints, which are reader chrome rather than PDF content: a selected Zotero
 * highlight and the temporary evidence region.
 */
export const shadowTheme = [
  '.textLayer ::selection{background:var(--dsw-alias-bg-document-selection)}',
  '.textLayer .highlight{--highlight-bg-color:var(--dsw-alias-bg-document-selection);--highlight-selected-bg-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 45%,transparent)}',
  '.commentPopup{--comment-bg-color:var(--dsw-alias-bg-layer-2);--comment-fg-color:var(--dsw-alias-label-primary);--comment-border-color:var(--dsw-alias-border-l2);--comment-date-fg-color:var(--dsw-alias-label-secondary);--comment-shadow:var(--dsw-shadow-lv2)}',
  ':host :focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:-2px}',
  '.zoteroAnnotations,.zoteroEvidence{position:absolute;inset:0;pointer-events:none}',
  '.zoteroAnnotations{z-index:1}',
  '.zoteroEvidence{z-index:2}',
  '.zoteroAnnotationSelected{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}',
  '.zoteroAnnotationComment{position:absolute;width:9px;height:9px;transform:translate(-100%,-40%);border-radius:50%;corner-shape:round;background:var(--dsw-alias-state-business-primary);border:1px solid var(--dsw-alias-bg-layer-2)}',
  // The evidence region marks text geometry, so it keeps a 2px corner rather than
  // the 4px UI step: a highlight rect is often only one line tall.
  '.zoteroEvidenceRegion{background-color:var(--dsw-alias-bg-document-selection);outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px;border-radius:2px}',
].join('\n')

/** @param {string} root repository root. @param {string} pluginId Harness package id. */
export async function buildReaderPdf(root, pluginId) {
  const pdfjs = dirname(require.resolve('pdfjs-dist/package.json'))
  const assets = await esbuild.build({
    entryPoints: [join(pdfjs, 'web/pdf_viewer.css')],
    bundle: true,
    minify: true,
    write: false,
    loader: { '.svg': 'dataurl', '.gif': 'dataurl', '.png': 'dataurl' },
    external: ['data:*'],
  })
  const stylesheet = `${assets.outputFiles[0].text.replaceAll(':root', ':host')}\n${shadowTheme}`
  const workerSource = await readFile(join(pdfjs, 'build/pdf.worker.min.mjs'), 'utf8')
  const output = join(root, 'lib')
  await mkdir(output, { recursive: true })
  const result = await esbuild.build({
    absWorkingDir: root,
    entryPoints: ['src/client/reader/pdf-runtime.ts'],
    outfile: join(output, chunk),
    platform: 'browser',
    target: 'es2022',
    format: 'cjs',
    bundle: true,
    minify: true,
    legalComments: 'inline',
    metafile: true,
    plugins: [
      {
        name: 'reader-pdf-assets',
        setup(build) {
          build.onResolve({ filter: /^reader-pdf-assets$/ }, (args) => ({
            path: args.path,
            namespace: 'reader-pdf',
          }))
          build.onLoad({ filter: /.*/, namespace: 'reader-pdf' }, () => ({
            loader: 'js',
            contents:
              'export const stylesheet = ' +
              JSON.stringify(stylesheet) +
              '\nexport const workerSource = ' +
              JSON.stringify(workerSource),
          }))
        },
      },
    ],
    banner: {
      js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pluginId)}, chunk: ${JSON.stringify(chunk)}, factory: () => { const module = { exports: {} }; const previousPdfjs = Object.getOwnPropertyDescriptor(globalThis, "pdfjsLib"); try {`,
    },
    footer: {
      js: 'return module.exports; } finally { if (previousPdfjs) Object.defineProperty(globalThis, "pdfjsLib", previousPdfjs); else delete globalThis.pdfjsLib; } } });',
    },
  })
  for (const input of Object.keys(result.metafile.inputs)) {
    if (
      input !== 'src/client/reader/pdf-runtime.ts' &&
      input !== 'src/client/reader/annotation-color.ts' &&
      input !== 'src/client/reader/pdf-capture.ts' &&
      input !== 'src/client/reader/pdf-excerpt.ts' &&
      input !== 'src/client/reader/pdf-evidence.ts' &&
      input !== 'src/client/reader/text-boundary.ts' &&
      input !== 'src/race-signal.ts' &&
      input !== 'reader-pdf:reader-pdf-assets' &&
      !input.startsWith('node_modules/pdfjs-dist/')
    )
      throw new Error(`Unexpected dependency in the Reader PDF chunk: ${input}`)
  }
  await copyFile(join(pdfjs, 'LICENSE'), join(output, 'reader-pdf.LICENSE'))
  await writeFile(
    join(output, 'reader-pdf.NOTICE'),
    'PDF.js (Mozilla), licensed under Apache-2.0.\n',
  )
}

/** Production-component Chromium fixture; complements the packaged app composition smoke. */
import { build } from 'esbuild'
import { transform } from 'lightningcss'
import { chromium } from 'playwright'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const output = process.argv[2] ?? '/tmp/dsh-zotero-parsed-ui'
mkdirSync(output, { recursive: true })
const css = {
  name: 'inline-css',
  setup(build) {
    build.onLoad({ filter: /dsh-client-ui-primitives[\/]lib[\/]index\.js$/ }, (args) => ({
      contents: readFileSync(args.path, 'utf8').replace(
        'function parseGfmWithMath(text) {',
        'function parseGfmWithMath(text) { globalThis.__parsedFullParses=(globalThis.__parsedFullParses??0)+1;',
      ),
      loader: 'js',
    }))
    build.onLoad({ filter: /\.css$/ }, (args) => {
      const result = transform({
        filename: args.path,
        code: readFileSync(args.path),
        cssModules: args.path.endsWith('.module.css'),
      })
      const names = Object.fromEntries(
        Object.entries(result.exports ?? {}).map(([name, value]) => [name, value.name]),
      )
      return {
        contents: `const tag=document.createElement('style');tag.textContent=${JSON.stringify(result.code.toString())};document.head.append(tag);export default ${JSON.stringify(names)};`,
        loader: 'js',
      }
    })
  },
}
const bundle = await build({
  stdin: {
    resolveDir: root,
    sourcefile: 'parsed-ui-fixture.tsx',
    loader: 'tsx',
    contents: `
import {createElement, useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {ICON_SYMBOLS} from '@deepseek-ai/dsh-client-ui-primitives';
const sprite=document.createElementNS('http://www.w3.org/2000/svg','svg');sprite.style.cssText='position:absolute;width:0;height:0;overflow:hidden';for(const [id,svg] of Object.entries(ICON_SYMBOLS)){const root=new DOMParser().parseFromString(svg,'image/svg+xml').documentElement;const symbol=document.createElementNS('http://www.w3.org/2000/svg','symbol');symbol.id=id;for(const {name,value} of root.attributes)if(!['width','height','xmlns','class','aria-hidden'].includes(name))symbol.setAttribute(name,value);symbol.append(...[...root.childNodes].map(n=>document.importNode(n,true)));sprite.append(symbol)}document.body.append(sprite);
import {PdfPickerDialog} from './src/client/components/PdfPickerDialog.tsx';
import {ParseDocumentDialog} from './src/client/enrichment/ParseDocumentDialog.tsx';
import {ParsedDocumentTab} from './src/client/components/library/ParsedDocumentTab.tsx';
import {ParsedDocuments} from './src/client/parsed-documents.ts';
import {ARTIFACT_READER_DEFAULTS} from './src/artifact-reader-preferences.ts';
import {en,zh} from './src/client/locales.ts';
const source=value=>{const listeners=new Set();return {getSnapshot:()=>value,subscribe:f=>{listeners.add(f);return()=>listeners.delete(f)},publish:v=>{value=v;for(const f of listeners)f()}}};
const access=source(true), snapshot=source({status:'loading'});
const sessionId='fixture',ref='zotero://user/0/attachment/PDF00001';
const address='dsh-resource://zotero-parsed/fixture/'+encodeURIComponent(ref);
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
let generation=1, fail=false; window.fixtureCalls=[]; window.inserted=[];
const read=async request=>{window.fixtureCalls.push(request.op);if(request.op==='release')return {ok:true,value:{kind:'released'}};
if(fail)throw Error('Fixture refresh failure');
const text='# Generation '+generation+'\\n\\nSelected passage\\n\\nEquation $x^2$\\n\\n![figure](images/figure.png)';
const artifactId=String(generation).repeat(64), lease='11111111-1111-4111-8111-111111111111';
if(request.op==='image')return {ok:true,value:{kind:'image',lease,artifactId,name:'images/figure.png',mediaType:'image/png',base64:png}};
return {ok:true,value:{kind:'opened',lease,artifactId,sourceId:'a'.repeat(64),fingerprint:'b'.repeat(64),targetLabel:'Attachment.pdf',mode:'free',characterCount:text.length,images:[{name:'images/figure.png',mediaType:'image/png',bytes:atob(png).length}],policy:ARTIFACT_READER_DEFAULTS,expiresAt:Date.now()+120000,page:{offset:0,text,totalChars:text.length}}}};
const documents=new ParsedDocuments(read,()=>access,console.error); const stop=new AbortController();
(async()=>{for await(const frame of documents.open(address,{signal:stop.signal})){snapshot.publish(frame.ok?{status:'live',value:frame.value}:{status:'failed',failure:frame.error,value:snapshot.getSnapshot().value})}})();
let root=createRoot(document.getElementById('app'));
const tFor=locale=>(key,args={})=>(locale==='zh'?zh:en)[key]?.replace(/\\{(\\w+)\\}/g,(_,key)=>String(args[key]??''))??key;
window.showFixture=(mode,locale='en')=>{const t=tFor(locale);let component;
if(mode==='picker')component=<PdfPickerDialog open onClose={()=>{}} title="Choose a PDF with a long paper title" t={t} options={Array.from({length:40},(_,i)=>({key:String(i),title:'Attachment '+i+' with a long title that should truncate.pdf',action:'Read PDF',onSelect:()=>{window.chosen=i}}))}/>;
else if(mode==='parse')component=<ParseDocumentDialog open selection={{sessionId,target:{kind:'attachment',ref},label:'A long selected attachment.pdf'}} remote={{documentArtifact:async()=>({ok:true,value:{kind:'missing'}}),startDocumentParse:async()=>{throw Error('No upload from UI fixture')},documentParseReceipt:async()=>({ok:true,value:{kind:'missing'}})}} capabilities={source({mounted:true,connected:true,mode:'free',revision:'1',maxFileBytes:10485760,maxPages:20,startAllowed:true,readAllowed:true,cancelAllowed:true,sessionAllowed:true})} onClose={()=>{}} locale={locale}/>;
else component=<ParsedDocumentTab t={t} sessionId={sessionId} refresh={value=>documents.refresh(value)} useResource={()=>useSyncExternalStore(snapshot.subscribe,snapshot.getSnapshot)} useAccess={()=>true} useSession={select=>select({removed:false})} useTabInfo={()=>({tab:{navigation:{address,params:{title:'Paper with a sufficiently long title to exercise the narrow toolbar'}},actions:{bindCommands:()=>()=>{}}}})} inputActions={{insertQuote:text=>{window.inserted.push(text);return true},persistDraft:()=>{}}}/>;
root.render(component)};
window.changeGeneration=()=>{generation++;documents.refresh(address)};window.failRefresh=()=>{fail=true;documents.refresh(address)};
window.showFixture('picker');
`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  plugins: [css],
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"MODE":"production"}' },
  loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
})
const themeDir = 'packages/client/ui-theme/src/styles'
const harness = resolve(root, '../deepseek-harness')
const run = (args) => execFileSync('git', ['-C', harness, ...args], { encoding: 'utf8' })
const sheets = run(['ls-tree', '--name-only', `dsh-v0.2.2-rc.2:${themeDir}`])
  .trim()
  .split('\n')
  .filter((name) => name.endsWith('.css'))
const theme = sheets.map((name) => run(['show', `dsh-v0.2.2-rc.2:${themeDir}/${name}`])).join('\n')
const browser = await chromium.launch({ headless: true })
const results = []
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 300 } })
  page.setDefaultTimeout(10_000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://parsed-ui.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app" style="height:100vh"></div>' }),
  )
  await page.goto('https://parsed-ui.test/')
  await page.addStyleTag({
    content:
      theme +
      '\nbody{margin:0;font-family:var(--dsw-font-family);--dsh-content-font-size:14px;--dsh-ui-font-size:13px}#app{height:100vh} ',
  })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  for (const dark of [false, true]) {
    await page.evaluate((dark) => document.body.toggleAttribute('data-ds-dark-theme', dark), dark)
    for (const size of [
      { width: 360, height: 300 },
      { width: 800, height: 600 },
    ]) {
      await page.setViewportSize(size)
      for (const mode of ['picker', 'parse', 'document']) {
        await page.evaluate((mode) => window.showFixture(mode, 'zh'), mode)
        if (mode !== 'document') await page.getByRole('dialog').waitFor()
        else
          await page
            .getByRole('heading', { name: 'Generation 1', exact: true })
            .waitFor()
            .catch(async (error) => {
              console.error(await page.locator('body').innerText())
              throw error
            })
        const layout = await page.evaluate((mode) => {
          const rect = document
            .querySelector(mode === 'document' ? 'section' : '[role=dialog]')
            .getBoundingClientRect()
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            clipped:
              rect.x < 0 || rect.y < 0 || rect.right > innerWidth || rect.bottom > innerHeight,
          }
        }, mode)
        if (layout.clipped) throw new Error(`${mode} exceeds viewport: ${JSON.stringify(layout)}`)
        if (mode === 'picker') {
          const last = page.getByRole('button', { name: /Attachment 39/ })
          await last.scrollIntoViewIfNeeded()
          await last.click()
          const close = await page.getByRole('button', { name: '关闭' }).boundingBox()
          if (!close || close.y < 24 || close.y + close.height > size.height - 24)
            throw new Error('Picker close control left the card viewport')
          if ((await page.evaluate(() => window.chosen)) !== 39)
            throw new Error('Last PDF choice inaccessible')
        }
        results.push({ dark, mode, ...size, layout })
        await page.screenshot({
          animations: 'disabled',
          path: join(output, `${mode}-${dark ? 'dark' : 'light'}-${size.width}.png`),
        })
      }
    }
  }
  await page.evaluate(() => {
    const range = document.createRange()
    range.selectNodeContents(
      [...document.querySelectorAll('p')].find((node) => node.textContent === 'Selected passage'),
    )
    const s = getSelection()
    s.removeAllRanges()
    s.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  await page.getByRole('menuitem', { name: '让模型解释' }).waitFor()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await page.getByRole('menu').waitFor({ state: 'detached' })
  const parsesBefore = await page.evaluate(() => window.__parsedFullParses)
  await page.evaluate(() => window.changeGeneration())
  await page.getByRole('heading', { name: 'Generation 2', exact: true }).waitFor()
  const parsesAfter = await page.evaluate(() => window.__parsedFullParses)
  if (parsesAfter - parsesBefore !== 1)
    throw new Error('A complete generation did not parse exactly once')
  await page.evaluate(() => window.failRefresh())
  await page.getByRole('alert').waitFor()
  if (!(await page.getByRole('heading', { name: 'Generation 2', exact: true }).isVisible()))
    throw new Error('Refresh failure discarded complete document')
  if ((await page.evaluate(() => window.__parsedFullParses)) !== parsesAfter)
    throw new Error('Failed refresh reparsed the retained document')
  if (errors.length) throw new Error(errors.join('\n'))
  writeFileSync(
    join(output, 'report.json'),
    JSON.stringify(
      {
        kind: 'production-component fixture',
        results,
        pageErrors: errors,
        fullParsesPerSuccessfulReplacement: parsesAfter - parsesBefore,
        actions: [
          'last PDF reachable',
          'selection keyboard dismiss',
          'complete generation replacement',
          'failed refresh retains previous document',
        ],
      },
      null,
      2,
    ),
  )
  console.log(
    `parsed UI fixture passed: ${results.length} layouts, report ${join(output, 'report.json')}`,
  )
} finally {
  await browser.close()
}

/// <reference path="./smoke-parsed-ui.d.ts" />
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/** Production-component Chromium fixture; complements the packaged app composition smoke. */
import { build } from 'esbuild'
import { transform } from 'lightningcss'
import { chromium } from 'playwright'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pinThemeSheets, pinnedHarness } from './style-tokens.mjs'
import { clientTestAliasesOf } from './client-test-platform.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = process.argv[2] ?? '/tmp/dsh-zotero-parsed-ui'
mkdirSync(output, { recursive: true })
const aliases = clientTestAliasesOf(root)
/** @type {import('esbuild').Plugin} */
const css = {
  name: 'inline-css',
  setup(build) {
    for (const { find, replacement } of aliases)
      build.onResolve({ filter: find }, () => ({ path: replacement }))
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
import {ICON_SYMBOLS, __$dsh_client_module_manifest as primitivesModule} from '@deepseek-ai/dsh-client-ui-primitives';
// The fixture imports the primitive library directly, outside the host renderer.
for (const [path, stylesheet] of Object.entries(primitivesModule.meta().stylesheets)) {
  const tag = document.createElement('style');
  tag.dataset.plugin = primitivesModule.id;
  tag.dataset.path = path;
  tag.textContent = stylesheet.text({asset: (reference) => reference});
  document.head.append(tag);
}
const sprite=document.createElementNS('http://www.w3.org/2000/svg','svg');sprite.style.cssText='position:absolute;width:0;height:0;overflow:hidden';for(const [id,svg] of Object.entries(ICON_SYMBOLS)){const root=new DOMParser().parseFromString(svg,'image/svg+xml').documentElement;const symbol=document.createElementNS('http://www.w3.org/2000/svg','symbol');symbol.id=id;for(const {name,value} of root.attributes)if(!['width','height','xmlns','class','aria-hidden'].includes(name))symbol.setAttribute(name,value);symbol.append(...[...root.childNodes].map(n=>document.importNode(n,true)));sprite.append(symbol)}document.body.append(sprite);
import {PdfPickerDialog} from './src/client/components/PdfPickerDialog.tsx';
import {ParseDocumentDialog} from './src/client/enrichment/ParseDocumentDialog.tsx';
import {ParsedDocumentTab} from './src/client/components/library/ParsedDocumentTab.tsx';
import {ParsedDocuments} from './src/client/parsed-documents.ts';
import {Context} from '@deepseek-ai/cordis';
import * as renderer from '@deepseek-ai/dsh-client-ui-renderer/client';
import * as menu from '@deepseek-ai/dsh-client-ui-context-menu/client';
import * as uiSession from '@deepseek-ai/dsh-client-ui-session/client';
import {createSnapshotStore} from '@deepseek-ai/dsh-client-store';
import {LibraryItemList} from './src/client/components/library/LibraryItemList.tsx';
import libraryCss from './src/client/components/library/library.module.css';
import {LibraryPreferencesContext} from './src/client/library-preferences.tsx';
import {LIBRARY_DEFAULTS} from './src/library-preferences.ts';
import {ARTIFACT_READER_DEFAULTS} from './src/artifact-reader-preferences.ts';
import {en,zh} from './src/client/locales.ts';
import {parseEn,parseZh} from './src/client/enrichment/parse-locales.ts';
window.fixtureReady=(async()=>{
const ctx=new Context();renderer.apply(ctx);
ctx.provide('sessions',{list:createSnapshotStore({phase:'ready',ids:[],byId:{}})});
const remoteListeners=new Map();ctx.provide('remote',{$on:(name,listener)=>{remoteListeners.set(name,listener);return()=>remoteListeners.delete(name)}});
ctx.provide('remoteAccess',{source:()=>{throw Error('Unexpected session access in an absent-session overlay')}});
uiSession.apply(ctx);
const dictionaries=new Map();
ctx.provide('locale',{register:(name,value)=>{dictionaries.set(name,value);return()=>dictionaries.delete(name)},bind:name=>key=>dictionaries.get(name)?.en?.[key]??key});
ctx.provide('shortcuts',{catalog:createSnapshotStore([])});
ctx.slots.installLocale({...createSnapshotStore({revision:0}),bind:name=>key=>dictionaries.get(name)?.en?.[key]??key});
ctx.slots.register({name:'root',children:{'shell.overlay':{kind:'list',scope:'root'}}},props=>props.renderSlot('shell.overlay',{}));
await ctx.plugin(menu,{});
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
const tFor=locale=>(key,args={})=>(locale==='zh'?{...zh,...parseZh}:{...en,...parseEn})[key]?.replace(/\\{(\\w+)\\}/g,(_,key)=>String(args[key]??''))??key;
const listMetrics={forJournal:name=>name==='Nature'?{status:'ready',fetchedAt:1,official:[{field:'sci',value:'Q1'},{field:'sciif',value:'4.0'},{field:'sciUp',value:'1'}],custom:[]}:undefined,retry:()=>{},retrying:false};
window.showFixture=(mode,locale='en')=>{const t=tFor(locale);let component;
if(mode.startsWith('list')){
const density=mode.includes('Compact')?'compact':'comfortable',titleLines=mode.endsWith('1')?1:2;
const items=['Nature','Journal of detailed experimental evidence in interdisciplinary research',undefined].map((venue,i)=>({ref:'zotero://user/0/item/PAPER00'+i,title:i===2?'':('A long literature title with detailed research findings and methodological evidence '.repeat(3)),itemType:'journalArticle',creatorSummary:'Researcher A; Researcher B; Researcher C; Researcher D; Researcher E',year:2026,venue,publicationTitle:i===0?venue:undefined,bestAttachmentType:'application/pdf',bestAttachmentRef:ref}));
component=<div className={libraryCss.panel}><LibraryPreferencesContext.Provider value={{preferences:{...LIBRARY_DEFAULTS,listDensity:density,titleLines}}}><LibraryItemList t={t} journalMetrics={listMetrics} list={{phase:'ready',items,total:3,offset:0,limit:20}} selection={{kind:'library'}} offset={0} gotoOffset={()=>{throw Error('Unexpected page')}} selectedRef={items[0].ref} selectItem={value=>window.selected=value} retry={()=>{throw Error('Unexpected retry')}} parsedArtifact={{sessionId,read:async()=>({ok:true,value:{kind:'probed',results:[{ref,state:'ready'}]}})}}/></LibraryPreferencesContext.Provider></div>;
}
else if(mode==='picker')component=<PdfPickerDialog open onClose={()=>{}} title="Choose a PDF with a long paper title" t={t} options={Array.from({length:40},(_,i)=>({key:String(i),title:'Attachment '+i+' with a long title that should truncate.pdf',action:'Read PDF',onSelect:()=>{window.chosen=i}}))}/>;
else if(mode==='parse')component=<ParseDocumentDialog open selection={{sessionId,target:{kind:'attachment',ref},label:'A long selected attachment.pdf'}} remote={{documentArtifact:async()=>({ok:true,value:{kind:'missing'}}),startDocumentParse:async()=>{throw Error('No upload from UI fixture')},documentParseReceipt:async()=>({ok:true,value:{kind:'missing'}})}} capabilities={source({mounted:true,connected:true,mode:'free',revision:'1',maxFileBytes:10485760,maxPages:20,startAllowed:true,readAllowed:true,cancelAllowed:true,sessionAllowed:true})} onClose={()=>{}} t={t}/>;
else component=<ParsedDocumentTab contextMenus={ctx.contextMenus} t={t} sessionId={sessionId} refresh={value=>documents.refresh(value)} useResource={()=>useSyncExternalStore(snapshot.subscribe,snapshot.getSnapshot)} useAccess={()=>true} useSession={select=>select({removed:false})} useTabInfo={()=>({tab:{navigation:{address,params:{title:'Paper with a sufficiently long title to exercise the narrow toolbar'}},actions:{bindCommands:()=>()=>{}}}})} inputActions={{insertQuote:text=>{window.inserted.push(text);return true},persistDraft:()=>{}}}/>;
root.render(<>{component}{ctx.slots.renderSlot('root',{})}</>)};
window.changeGeneration=()=>{generation++;documents.refresh(address)};window.failRefresh=()=>{fail=true;documents.refresh(address)};
window.showFixture('picker');
})();
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
const pin = pinnedHarness(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')))
if (!pin) throw new Error('No pinned harness theme for the browser fixture')
const harness = resolve(root, '../deepseek-harness')
const sheets = pinThemeSheets(
  (args) => execFileSync('git', args, { encoding: 'utf8' }),
  harness,
  pin,
)
const theme = sheets.files.map(sheets.read).join('\n')
const browser = await chromium.launch({ headless: true })
const results = []
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 300 } })
  page.setDefaultTimeout(10_000)
  /** @type {string[]} */
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://parsed-ui.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app" style="height:100vh"></div>' }),
  )
  await page.goto('https://parsed-ui.test/')
  await page.addStyleTag({
    content:
      theme +
      '\nbody{margin:0;font-family:var(--dsw-font-family);--dsh-content-font-size:14px;--dsh-ui-font-size:13px}#app{height:100vh;display:flex;flex-direction:column} ',
  })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.evaluate(() => window.fixtureReady)
  for (const dark of [false, true]) {
    await page.evaluate((dark) => document.body.toggleAttribute('data-ds-dark-theme', dark), dark)
    for (const size of [
      { width: 360, height: 300 },
      { width: 800, height: 600 },
    ]) {
      await page.setViewportSize(size)
      for (const mode of [
        'picker',
        'parse',
        'document',
        'listComfortable1',
        'listCompact1',
        'listComfortable2',
        'listCompact2',
      ]) {
        await page.evaluate((mode) => window.showFixture(mode, 'zh'), mode)
        if (mode.startsWith('list')) {
          await page.locator('button[aria-current=true]').waitFor()
          await page.getByText('MD', { exact: true }).first().waitFor()
        } else if (mode !== 'document')
          await page
            .getByRole('dialog')
            .waitFor()
            .catch(async (error) => {
              writeFileSync(
                join(output, 'failure.json'),
                JSON.stringify(
                  { mode, errors, body: await page.locator('body').innerText() },
                  null,
                  2,
                ),
              )
              await page.screenshot({ path: join(output, 'failure.png') })
              throw error
            })
        else
          await page
            .getByRole('heading', { name: 'Generation 1', exact: true, level: 1 })
            .waitFor()
            .catch(async (error) => {
              console.error(await page.locator('body').innerText())
              throw error
            })
        /** @type {{ x: number, y: number, width: number, height: number, clipped: boolean, rows?: { height: number, contentHeight: number, clipped: boolean, label: string | null }[] }} */
        const layout = await page.evaluate((mode) => {
          const surface = document.querySelector(
            mode === 'document' || mode.startsWith('list') ? 'section' : '[role=dialog]',
          )
          if (!surface) throw new Error(`Missing fixture surface: ${mode}`)
          const rect = surface.getBoundingClientRect()
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
        if (mode.startsWith('list')) {
          const rows = await page.locator('li > button').evaluateAll((buttons) =>
            buttons.map((button) => {
              const box = button.getBoundingClientRect()
              if (!button.firstElementChild) throw new Error('Library row has no content')
              const content = button.firstElementChild.getBoundingClientRect()
              return {
                height: box.height,
                contentHeight: content.height,
                clipped: content.top < box.top || content.bottom > box.bottom,
                label: button.textContent,
              }
            }),
          )
          if (rows.length !== 3 || rows.some((row) => row.clipped || row.height < 28 || !row.label))
            throw new Error(`Library content was clipped or unlabeled: ${JSON.stringify(rows)}`)
          const nature = page.locator('span[title="Nature"]')
          const venueFits = await nature.evaluate(
            (venue) => venue.scrollWidth === venue.clientWidth,
          )
          if (!venueFits) throw new Error('Short journal name clipped in library row')
          const metricRow = page.locator('li > button').first()
          for (const title of ['JCR Q1', 'IF 4.0']) {
            const metric = page.locator(`span[title="${title}"]`)
            if ((await metric.count()) !== 1 || !(await metricRow.locator(metric).isVisible()))
              throw new Error(`Expected one visible ${title} in the first library row`)
          }
          const cas = metricRow.locator('span[title="中科院 1"]')
          const compact = mode.includes('Compact')
          if ((await cas.count()) !== (compact ? 0 : 1))
            throw new Error('CAS quartile rendered in the wrong density')
          if ((await cas.isVisible()) !== (!compact && size.width > 460))
            throw new Error('CAS quartile visibility did not follow the library container width')
          if (size.width === 360) {
            const authorClipped = await nature.evaluate((venue) => {
              const authors = venue.nextElementSibling
              return authors && authors.scrollWidth > authors.clientWidth
            })
            if (!authorClipped) throw new Error('Authors did not yield space to the journal name')
            const longVenue = await page
              .locator('span[title^="Journal of detailed"]')
              .evaluate((venue) => {
                return {
                  layoutWidth: venue.clientWidth,
                  availableWidth: venue.parentElement?.clientWidth,
                  fullWidth: venue.scrollWidth,
                }
              })
            if (
              longVenue.layoutWidth !== longVenue.availableWidth ||
              longVenue.fullWidth <= longVenue.layoutWidth
            )
              throw new Error('Long journal name did not use the available byline width')
          }
          const last = page.locator('li > button').last()
          await last.scrollIntoViewIfNeeded()
          await last.click()
          if ((await page.evaluate(() => window.selected)) !== 'zotero://user/0/item/PAPER002')
            throw new Error('Last literature row was not reachable')
          await page.locator('button[aria-current=true]').scrollIntoViewIfNeeded()
          await page.locator('button[aria-current=true]').click()
          if ((await page.evaluate(() => window.selected)) !== undefined)
            throw new Error('Selected literature row did not deselect')
          layout.rows = rows
        }
        results.push({ dark, mode, ...size, layout })
        await page.screenshot({
          animations: 'disabled',
          path: join(output, `${mode}-${dark ? 'dark' : 'light'}-${size.width}.png`),
        })
      }
    }
  }
  await page.evaluate(() => window.showFixture('document', 'zh'))
  await page.getByRole('heading', { name: 'Generation 1', exact: true, level: 1 }).waitFor()
  await page.evaluate(() => {
    const passage = [...document.querySelectorAll('p')].find(
      (node) => node.textContent === 'Selected passage',
    )
    const selection = getSelection()
    if (!passage || !selection) throw new Error('Fixture passage selection is unavailable')
    const range = document.createRange()
    range.selectNodeContents(passage)
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  await page.getByRole('menuitem', { name: '让模型解释' }).waitFor()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await page.getByRole('menu').waitFor({ state: 'detached' })
  const parsesBefore = await page.evaluate(() => window.__parsedFullParses)
  await page.evaluate(() => window.changeGeneration())
  const currentHeading = page.getByRole('heading', { name: 'Generation 2', exact: true, level: 1 })
  await currentHeading.waitFor()
  const parsesAfter = await page.evaluate(() => window.__parsedFullParses)
  if (parsesAfter - parsesBefore !== 1)
    throw new Error('A complete generation did not parse exactly once')
  await page.evaluate(() => window.failRefresh())
  await page.getByRole('alert').waitFor()
  if (!(await currentHeading.isVisible()))
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

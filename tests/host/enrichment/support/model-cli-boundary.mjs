/** Child-process boundary for the real CLI: synthetic catalog and zero network I/O. */
import { registerHooks } from 'node:module'
import {
  atomicPort,
  fetchPort,
  fixture,
  fsPort,
  notify,
  TestProxyAgent,
} from './model-cli-control.mjs'

const controlUrl = new URL('./model-cli-control.mjs', import.meta.url).href
const catalogUrl = 'wp4-test:catalog'
const httpUrl = 'wp4-test:http'
const filesystemUrl = 'wp4-test:filesystem'
const atomicUrl = 'wp4-test:atomic'
const ports = Symbol.for('wp4-cli-test-ports')
globalThis[ports] = { fsPort, atomicPort, fetchPort, TestProxyAgent }

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.endsWith('/semantic-model-catalog.mjs') ||
      specifier === './semantic-model-catalog.mjs'
    ) {
      return { url: catalogUrl, shortCircuit: true }
    }
    if (specifier === 'undici') return { url: httpUrl, shortCircuit: true }
    if (context.parentURL !== controlUrl && specifier === 'node:fs/promises') {
      return { url: filesystemUrl, shortCircuit: true }
    }
    if (context.parentURL !== controlUrl && specifier === '@deepseek-ai/dsh-atomic-write') {
      return { url: atomicUrl, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url === catalogUrl) {
      return {
        format: 'module',
        shortCircuit: true,
        source: `
          export const DEFAULT_SEMANTIC_MODEL = 'balanced';
          export const DEFAULT_SEMANTIC_MODEL_ROOT = '~/.dsh/models';
          export const SEMANTIC_MODELS = [${JSON.stringify(fixture.model)}];
          export const SEMANTIC_MODEL_KEYS = ['balanced'];
          export const semanticModelOf = () => SEMANTIC_MODELS[0];
          export const semanticModelBytes = model => model.files.reduce((n, f) => n + f.bytes, 0);
          export const manifestOf = () => (${JSON.stringify(fixture.manifest)});
        `,
      }
    }
    if (url === filesystemUrl || url === atomicUrl) {
      const name = url === filesystemUrl ? 'fsPort' : 'atomicPort'
      const port = url === filesystemUrl ? fsPort : atomicPort
      return {
        format: 'module',
        shortCircuit: true,
        source: Object.keys(port)
          .filter((key) => key !== 'default')
          .map(
            (key) =>
              `export const ${key} = globalThis[Symbol.for('wp4-cli-test-ports')].${name}.${key};`,
          )
          .join('\n'),
      }
    }
    if (url === httpUrl) {
      // The child never imports a real HTTP client. Filesystem and lock
      // observers delegate to the real Node/public Harness implementations.
      return {
        format: 'module',
        shortCircuit: true,
        source: `
          const ports = globalThis[Symbol.for('wp4-cli-test-ports')];
          export const EnvHttpProxyAgent = ports.TestProxyAgent;
          export const ProxyAgent = ports.TestProxyAgent;
          export const fetch = ports.fetchPort;
        `,
      }
    }
    return nextLoad(url, context)
  },
})

// Explicitly refuse accidental use of the global network API as well.
globalThis.fetch = async () => {
  throw new Error('Unscripted global HTTP request')
}
notify('boundary-ready')

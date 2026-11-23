/** The worker entry URL: the emitted artifact, or its TypeScript source during development. */
export function workerEntryUrl(entry: URL): URL {
  if (!import.meta.url.endsWith('.ts')) return entry

  const source = entry.href.slice(0, -3) + '.ts'
  const root = new URL('../', import.meta.url).href
  const bootstrap = `import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') &&
        context.parentURL?.startsWith(${JSON.stringify(root)})) {
      return nextResolve(specifier.slice(0, -3) + '.ts', context);
    }
    return nextResolve(specifier, context);
  },
});
await import(${JSON.stringify(source)});`
  return new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`)
}

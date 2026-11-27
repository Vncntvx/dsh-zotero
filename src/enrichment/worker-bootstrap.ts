/** Workers start in a separate realm without the Harness profile resolver. */
export function workerEntryUrl(entry: URL, hostPackages: readonly string[] = []): URL {
  const development = import.meta.url.endsWith('.ts')
  if (!development && hostPackages.length === 0) return entry

  const source = development ? entry.href.slice(0, -3) + '.ts' : entry.href
  const root = new URL('../', import.meta.url).href
  const dependencies = Object.fromEntries(
    hostPackages.map((name) => [name, import.meta.resolve(name)]),
  )
  const bootstrap = `import { registerHooks } from 'node:module';
const dependencies = JSON.parse(${JSON.stringify(JSON.stringify(dependencies))});
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(${JSON.stringify(root)})) {
      if (Object.hasOwn(dependencies, specifier)) return nextResolve(dependencies[specifier], context);
      if (${development} && specifier.startsWith('.') && specifier.endsWith('.js')) {
        return nextResolve(specifier.slice(0, -3) + '.ts', context);
      }
    }
    return nextResolve(specifier, context);
  },
});
await import(${JSON.stringify(source)});`
  return new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`)
}

/**
 * Vite's `?raw` suffix imports any file as its source text. One ambient
 * declaration covers every `*?raw` specifier in the client test lane.
 */
declare module '*?raw' {
  const content: string
  export default content
}

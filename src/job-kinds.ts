/** Host-only registration of the plugin's owned job kinds. */
import type {} from '@deepseek-ai/dsh-jobs'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    zotero: 'zotero'
    scholarly: 'scholarly'
  }
}

export {}

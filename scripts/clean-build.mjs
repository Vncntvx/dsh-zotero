/** Clear generated output before a full emit. */
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
rmSync(fileURLToPath(new URL('../lib/', import.meta.url)), { recursive: true, force: true })

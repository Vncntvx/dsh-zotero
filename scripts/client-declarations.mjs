/** Keep host execution declarations outside the browser's TypeScript program. */
import { execFileSync } from 'node:child_process'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hostEntries = [
  /\/@deepseek-ai\/dsh-(?:jobs|tools|agent)\/lib\/types\/index\.d\.ts$/,
  /\/src\/(?:service|job-kinds|write-call|http-client|result-delivery)\.ts$/,
]

/** @param {readonly string[]} files @returns {string[]} offending compiler inputs */
export function clientDeclarationProblems(files) {
  return files.filter((file) =>
    hostEntries.some((pattern) => pattern.test(file.replaceAll('\\', '/'))),
  )
}

/** @param {string} [project] @returns {string[]} actual compiler-resolved files */
export function clientProgramFiles(project = resolve(root, 'tsconfig.client.json')) {
  const output = execFileSync(
    process.execPath,
    [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', project, '--listFilesOnly'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    },
  )
  return output.trim().split(/\r?\n/).filter(Boolean)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = clientDeclarationProblems(clientProgramFiles())
  if (problems.length > 0) {
    for (const file of problems)
      console.error(`Browser declaration program includes host execution: ${relative(root, file)}`)
    process.exitCode = 1
  } else
    console.log(
      'client declaration boundary ok: compiler-resolved browser program contains no host execution entries',
    )
}

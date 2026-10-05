/**
 * Prepares and publishes a standalone prebuilt `release` branch.
 *
 * Why this exists:
 * When users install this plugin from GitHub (`github:Vncntvx/dsh-zotero`),
 * pnpm (>=10) executes the package's `prepare` script because source repos
 * do not commit `lib/`. However, pnpm blocks git-hosted dependencies from
 * executing lifecycle scripts by default (supply-chain security) unless
 * allowed in `allowBuilds`.
 *
 * This script builds the plugin, creates an isolated worktree, populates it
 * with prebuilt artifacts (`lib/`, manifest, locales, assets), strips the
 * `prepare` script from `package.json`, and pushes it to the `release` branch.
 * Installing `github:Vncntvx/dsh-zotero#release` therefore requires zero build
 * scripts and zero `allowBuilds` approval.
 *
 * @module scripts/publish-release-branch
 */

import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function runGit(args, cwd = root) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function parseArgs() {
  const argv = process.argv.slice(2)
  return {
    dryRun: argv.includes('--dry-run'),
    push: argv.includes('--push'),
    branch: argv.includes('--branch') ? argv[argv.indexOf('--branch') + 1] : 'release',
    remote: argv.includes('--remote') ? argv[argv.indexOf('--remote') + 1] : 'origin',
  }
}

const options = parseArgs()
console.log(
  `[release-branch] Preparing ${options.branch} (dryRun=${options.dryRun}, push=${options.push})`,
)

// 1. Prove and build artifacts
console.log('[release-branch] Building project (Node and Client bundles)...')
execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' })

const requiredFiles = ['lib/index.js', 'lib/client.js']
for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) {
    throw new Error(`[release-branch] Required build artifact missing: ${file}`)
  }
}

// 2. Read package.json and sanitize for release branch
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const releaseManifest = { ...manifest }

// Remove prepare script so pnpm treats this as a prebuilt package requiring no build execution
if (releaseManifest.scripts) {
  const { prepare, prepublishOnly, ...safeScripts } = releaseManifest.scripts
  releaseManifest.scripts = safeScripts
}

// 3. Create isolated git worktree
const tempWorktree = mkdtempSync(join(tmpdir(), 'dsh-zotero-release-worktree-'))
const orphanBranchName = `temp-release-${Date.now()}`

try {
  console.log(`[release-branch] Creating temporary worktree at ${tempWorktree}`)
  runGit(['worktree', 'add', '--detach', tempWorktree])

  runGit(['checkout', '--orphan', orphanBranchName], tempWorktree)
  runGit(['rm', '-rf', '.'], tempWorktree)

  // 4. Copy published files as declared in package.json "files"
  // The release branch carries exactly what the package ships; the manifest
  // is already parsed above, so a files entry added there ships without this
  // list ever being edited again.
  const filesToCopy = Array.isArray(manifest.files)
    ? manifest.files.filter((file) => typeof file === 'string')
    : []

  for (const item of filesToCopy) {
    const srcPath = join(root, item)
    const dstPath = join(tempWorktree, item)
    if (!existsSync(srcPath)) {
      console.warn(`[release-branch] Warning: optional/declared path missing: ${item}`)
      continue
    }
    mkdirSync(dirname(dstPath), { recursive: true })
    cpSync(srcPath, dstPath, { recursive: true })
  }

  // Copy LICENSE if present
  if (existsSync(join(root, 'LICENSE'))) {
    cpSync(join(root, 'LICENSE'), join(tempWorktree, 'LICENSE'))
  }

  // Write sanitized package.json
  writeFileSync(join(tempWorktree, 'package.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`)

  // Write release branch .gitignore
  writeFileSync(join(tempWorktree, '.gitignore'), 'node_modules\n*.log\n.DS_Store\n.env*\n')

  // 5. Commit to orphan branch
  runGit(['add', '-A'], tempWorktree)
  const status = runGit(['status', '--porcelain'], tempWorktree)
  if (!status) {
    console.log('[release-branch] No changes detected in release branch.')
  } else {
    runGit(['commit', '-m', 'chore(release): prebuilt release bundle [skip ci]'], tempWorktree)
    console.log('[release-branch] Committed prebuilt bundle.')
  }

  // Update target local branch ref
  runGit(['branch', '-f', options.branch, 'HEAD'], tempWorktree)
  console.log(`[release-branch] Updated local branch ref "${options.branch}".`)

  // 6. Push to remote if requested
  if (options.push && !options.dryRun) {
    console.log(`[release-branch] Pushing ${options.branch} to ${options.remote}...`)
    runGit(['push', '-f', options.remote, `${options.branch}:${options.branch}`])
    console.log(`[release-branch] Successfully pushed ${options.branch} to ${options.remote}.`)
  } else if (options.dryRun) {
    console.log('[release-branch] Dry-run complete. Skipping git push.')
  } else {
    console.log(
      `[release-branch] Local branch "${options.branch}" is ready. Pass --push to push to ${options.remote}.`,
    )
  }
} finally {
  console.log('[release-branch] Cleaning up temporary worktree...')
  try {
    runGit(['worktree', 'remove', '--force', tempWorktree])
  } catch (err) {
    console.warn(`[release-branch] Failed to remove worktree: ${err.message}`)
  }
  try {
    runGit(['branch', '-D', orphanBranchName])
  } catch {}
  rmSync(tempWorktree, { recursive: true, force: true })
}

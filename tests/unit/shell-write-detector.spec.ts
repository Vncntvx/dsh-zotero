/**
 * The shell-write detector's rule table.
 *
 * The detector is a pure function over command text, so its whole contract can
 * be pinned here without a server: what it recognizes as a write against
 * Zotero's own API, what it deliberately leaves alone, and that it is total —
 * it runs inside the `tools/pre-execute` waterfall before every tool body, so
 * a throw would break calls it was never meant to touch. The cases at the end
 * spell out the honest limits of text-based detection.
 * @module tests/unit/shell-write-detector
 */

import { describe, expect, it } from 'vitest'
import { detectShellWrite } from '../../src/shell-write-detector.js'

const BASE = 'http://127.0.0.1:23119/api'

/** The resolved fields the rule reads. */
const config = { baseUrl: BASE } as const

/** One `bash` call carrying the given command text. */
function bash(command: string): { name: string; arguments: { command: string } } {
  return { name: 'bash', arguments: { command } }
}

describe('the shell-write detector', () => {
  it('recognizes the authorize endpoint in any spelling', () => {
    for (const command of [
      `curl -s -X POST -d '{"appName":"x"}' http://127.0.0.1:23119/api/local/authorize`,
      `curl -H 'Zotero-Server-ID: abc' --request=POST https://localhost:23119/api/local/authorize`,
      `KEY=$(curl -s http://[::1]:23119/api/local/authorize)`,
    ]) {
      const attempt = detectShellWrite(config, bash(command))
      expect(attempt, command).toBeDefined()
      expect(attempt?.reason).toContain('authorize endpoint')
      expect(attempt?.displayReason.en).toContain('zotero_create_note')
      expect(attempt?.displayReason.zh).toContain('zotero_create_note')
      // Each arm is written in its own language: the Chinese text carries the
      // translated shape, never the English audit spelling.
      expect(attempt?.displayReason.zh).toContain('授权端点')
      expect(attempt?.displayReason.zh).not.toContain('authorize endpoint')
    }
  })

  it('recognizes a write-shaped request against the configured local address', () => {
    for (const command of [
      `curl -X POST http://127.0.0.1:23119/api/users/0/items -H 'Content-Type: application/json' -d @/tmp/note.json`,
      `curl --data-binary @/tmp/n.json http://localhost:23119/api/users/0/items`,
      `curl -T /tmp/note.json http://127.0.0.1:23119/api/users/0/items`,
      `wget --post-file=/tmp/note.json http://127.0.0.1:23119/api/users/0/items`,
      `http POST http://127.0.0.1:23119/api/users/0/items < /tmp/note.json`,
      `Invoke-RestMethod -Method Post -Uri http://127.0.0.1:23119/api/users/0/items -Body '{}'`,
      `python3 -c "import requests; requests.post('http://127.0.0.1:23119/api/users/0/items', json={})"`,
    ]) {
      expect(detectShellWrite(config, bash(command)), command).toBeDefined()
    }
  })

  it('recognizes a write to the users endpoint even at another loopback port', () => {
    for (const command of [
      `curl -X PATCH http://127.0.0.1:9999/api/users/0/items/ABCD1234 -d '{}'`,
      `curl -X POST http://localhost:9999/api/users/0/items -d '{}'`,
      `curl -X POST http://[::1]:9999/api/users/0/items -d '{}'`,
    ]) {
      expect(detectShellWrite(config, bash(command)), command).toBeDefined()
    }
  })

  it('never treats a write against a non-loopback host as a library write', () => {
    for (const command of [
      `curl -X POST -d @n.json https://api.zotero.org/api/users/123/items`,
      `curl -X POST https://api.zotero.org/api/users/123/items -d '{}'`,
      `curl -X PATCH https://example.com/api/users/0/items/ABCD1234 -d '{}'`,
      `python3 -c "import requests; requests.post('https://api.zotero.org/api/users/1/items', json={})"`,
    ]) {
      expect(detectShellWrite(config, bash(command)), command).toBeUndefined()
    }
  })

  it('leaves a command alone when the address is only mentioned, whatever flags it uses', () => {
    // The regression this rule was rebuilt for: an ordinary build command that
    // spells the local address in a string literal and also runs `rm -f` must
    // not raise an approval prompt. The write shapes are anchored on an HTTP
    // client invocation, so an unrelated flag is never a write intent.
    for (const command of [
      `cd /repo && npm run build && node -e "check({ baseUrl: '${BASE}' })" && rm -f /tmp/x`,
      `grep -rn "${BASE.replace('http://', '')}" docs/ | head -5`,
      `curl -s -f http://127.0.0.1:23119/api/users/0/items?limit=1`,
      `curl -s http://127.0.0.1:23119/api/ -o /dev/null && date -d 'yesterday'`,
      `tar -t -f /tmp/backup.tar.gz`,
    ]) {
      expect(detectShellWrite(config, bash(command)), command).toBeUndefined()
    }
  })

  it('never joins a read with a later step’s write-shaped token', () => {
    // Proximity is segment-scoped: `POST` after `&&` is a later command, not
    // the method of the curl that ran before it.
    for (const command of [
      `curl -s http://127.0.0.1:23119/api/ && echo POST done`,
      `curl -s http://127.0.0.1:23119/api/users/0/items?limit=1 && date -d yesterday`,
      `curl -s http://127.0.0.1:23119/api/; python -c 'x.post()'`,
      `echo hello | curl -s http://127.0.0.1:23119/api/ | grep -v DELETE`,
      `curl -s http://127.0.0.1:23119/api/ && wget --spider http://127.0.0.1:23119/api/`,
    ]) {
      expect(detectShellWrite(config, bash(command)), command).toBeUndefined()
    }
  })

  it('leaves reads, other hosts, and unrelated bodies alone', () => {
    for (const command of [
      `curl -s http://127.0.0.1:23119/api/users/0/items?limit=1`,
      `curl -s -o /dev/null -w '%{http_code}' http://localhost:23119/api/`,
      `Get-Content http://127.0.0.1:23119/api/users/0/items`,
      `curl -X POST -d '{"q":1}' https://api.example.com/v1/search`,
      `curl -I https://example.com`,
      `pdflatex -interaction=nonstopmode paper.tex`,
      `git commit -m "note: describe the write path"`,
    ]) {
      expect(detectShellWrite(config, bash(command)), command).toBeUndefined()
    }
  })

  it('names both the detected route and the sanctioned one', () => {
    const attempt = detectShellWrite(
      config,
      bash(`curl -X POST -d '{}' http://127.0.0.1:23119/api/users/0/items`),
    )
    expect(attempt?.reason).toContain('outside the plugin')
    expect(attempt?.reason).toContain('zotero_add_tags')
    expect(attempt?.reason).toContain('approval policy is "never"')
    expect(attempt?.displayReason.en).toContain('local API')
    expect(attempt?.displayReason.zh).toContain('本地接口')
    expect(attempt?.displayReason.zh).toContain('本地 API 地址的写请求')
    expect(attempt?.displayReason.zh).not.toContain('write request to the local API address')
  })

  it('leaves every non-shell call alone', () => {
    expect(
      detectShellWrite(config, { name: 'read', arguments: { file_path: '/tmp/x' } }),
    ).toBeUndefined()
    expect(
      detectShellWrite(config, {
        name: 'bash',
        arguments: { command: 'true', description: 'noop' },
      }),
    ).toBeUndefined()
  })

  it('is total: odd arguments never throw and never match', () => {
    for (const execution of [
      { name: 'bash', arguments: undefined },
      { name: 'bash', arguments: null },
      { name: 'bash', arguments: 'a string' },
      { name: 'bash', arguments: {} },
      { name: 'bash', arguments: { command: 42 } },
      { name: 'bash', arguments: { command: '   ' } },
      { name: 'pwsh', arguments: { command: '' } },
    ] as readonly { name: string; arguments: unknown }[]) {
      expect(() => detectShellWrite(config, execution)).not.toThrow()
      expect(detectShellWrite(config, execution)).toBeUndefined()
    }
  })

  it('does not match on an authority alone when the configured address carries no port', () => {
    const noPort = { baseUrl: 'http://127.0.0.1/api' }
    expect(
      detectShellWrite(noPort, bash(`curl -s http://127.0.0.1/api/users/0/items`)),
    ).toBeUndefined()
    expect(
      detectShellWrite(noPort, bash(`curl -X POST http://127.0.0.1/api/local/authorize`)),
    ).toBeDefined()
  })

  it('treats an unparseable baseUrl as no configured aliases', () => {
    const broken = { baseUrl: 'not a url' }
    expect(
      detectShellWrite(
        broken,
        bash(`curl -X POST http://127.0.0.1:23119/api/users/0/items -d '{}'`),
      ),
    ).toBeDefined()
    expect(
      detectShellWrite(broken, bash(`curl -X POST http://127.0.0.1:23119/api/ -d '{}'`)),
    ).toBeUndefined()
  })

  it('documents the shapes text matching cannot see', () => {
    // These get through by design; the plugin keeps the model on the sanctioned
    // route with the prompt, and the harness never sees them to ask about.
    for (const command of [
      `bash /tmp/note.sh`,
      `python3 -c "import os,requests; requests.post(os.environ['ZOTERO_URL'], json={})"`,
    ]) {
      expect(detectShellWrite(config, bash(command)), command).toBeUndefined()
    }
  })
})

# Security Policy

## Supported Versions

Only the latest published release receives security fixes. Update to the newest
version before reporting an issue that may already be fixed.

| Version | Supported          |
| ------- | ------------------ |
| 0.14.x  | :white_check_mark: |
| < 0.14  | :x:                |

## Reporting a Vulnerability

Report suspected vulnerabilities privately by emailing
[wenjie.xu.cn@outlook.com](mailto:wenjie.xu.cn@outlook.com); security-sensitive
matters are handled by private email rather than public issues.

Include the affected version, reproduction steps, and impact. You can expect an
acknowledgement within 14 days; fixes for confirmed issues are released through
the normal release flow, and reporters are credited unless they prefer
otherwise.

## Security Design Invariants

These properties are intentional; regressions are treated as security bugs. The
[product model](docs/product-model.md) explains how the surfaces split.

- **Loopback only**: the plugin refuses any non-loopback Zotero Local API base
  URL and declines HTTP redirects, so requests cannot be steered to remote
  hosts.
- **Approval-gated writes**: every write targets the personal library and
  passes the capability gate plus an explicit user approval with a plan-review
  card. A stale configuration flag cannot opt out, and writes are never retried
  blindly.
- **Credentials stay in the credential seam**: the Zotero write grant is stored
  in the harness credentials store, never in plugin configuration, logs, or
  fixtures.
- **Request-driven core**: the core bundle performs no external network calls.
  External scholarly requests exist only inside the opt-in `dsh-zotero/scholarly`
  component, behind an SSRF-guarded transport.
- **Rejection messages leak nothing**: tool errors name hostnames at most; full
  URLs, which can carry credentials or DOIs, are never echoed back.
- **Session-log maintenance goes through the persistence seam**: the repair
  rewrites stored session files only through
  `ctx.sessionPersistence.openArtifactMaintenance`, which holds the session's
  write exclusion, keeps a byte-exact 0600 backup, and re-validates the whole
  log against the storage contract before publishing. The plugin opens no file
  itself. Only the retired type `zotero/status` may be marked; a request cannot
  name other types, and the panel confirms the action before it runs. Cache and
  credential stores are outside this capability.

## Supply Chain

The release workflow pins every third-party GitHub Action to an immutable commit
SHA, `npm run deps:check` reports direct dependencies behind their published
release, Dependabot alerts surface known vulnerabilities without opening
automated update pull requests, and the HOL Guard scanner runs on every pull
request with `contents: read` only and no persisted checkout credentials.

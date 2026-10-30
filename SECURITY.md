# Security Policy

## Supported Versions

Only the latest release receives security fixes. Update to the newest version before reporting an issue that may already be fixed.

## Reporting a Vulnerability

Report suspected vulnerabilities privately by emailing [wenjie.xu.cn@outlook.com](mailto:wenjie.xu.cn@outlook.com). Please do not open a public issue for anything security-sensitive.

Include the affected version, reproduction steps, and impact. You can expect an acknowledgement within 14 days; fixes for confirmed issues are released through the normal release flow, and reporters are credited unless they prefer otherwise.

## Security Design Invariants

These properties are intentional; regressions are treated as security bugs:

- **Loopback only**: the plugin refuses any non-loopback Zotero Local API base URL and declines HTTP redirects, so requests cannot be steered to remote hosts.
- **Approval-gated writes**: every write targets the personal library and passes the capability gate plus an explicit user approval with a plan-review card. A stale configuration flag cannot opt out, and writes are never retried blindly.
- **Credentials stay in the credential seam**: the Zotero write grant is stored in the harness credentials store, never in plugin configuration, logs, or fixtures.
- **Request-driven core**: the core bundle performs no external network calls. External scholarly requests exist only inside the opt-in `dsh-zotero/scholarly` component, behind an SSRF-guarded transport.
- **Rejection messages leak nothing**: tool errors name hostnames at most; full URLs, which can carry credentials or DOIs, are never echoed back.

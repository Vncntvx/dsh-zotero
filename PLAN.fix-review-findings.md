# dsh-zotero 审阅问题修复计划

对照 `REVIEW-2026-09-28.md`，按「正确性/安全 → 发布门禁 → 样式契约 → 清理」四阶段推进。
每个阶段可独立合并；阶段内按依赖排序。验证命令统一为 `npm run typecheck && npm test`，浏览器半侧加 `npm run build:client`。

---

## 阶段 1 — 正确性 / 安全（优先）

### 1.1 I1 写审批缺 agent 时 fail-open

**文件**：`src/write-approval.ts`、`tests/tools/write-approval-policy.spec.ts`

**改动**：

```ts
// write-approval.ts:115-119
// 现状（错误）：
if (approval === undefined || exec.agent === undefined) return 'allowed'

// 改为：
if (approval === undefined) return 'allowed'
if (exec.agent === undefined) return 'unavailable'
```

同步更新模块头 settlement map 注释（21-22 行）保持与实现一致。

**测试**：`write-approval-policy.spec.ts:61-80` 的
`skips the approval gate without an approval service or without an agent`
拆成两用例：

- 无 approval 服务 → `'allowed'`（保持）
- 有 approval 服务但无 agent → `'unavailable'`（翻转断言）

**验收**：`npx vitest run tests/tools/write-approval-policy.spec.ts`

---

### 1.2 I2 共享连通性提问被首调用方 abort 连坐

**文件**：`src/ask.ts`

**改动**（二选一，推荐 A）：

**方案 A（推荐）— gate 自有 AbortController**：
在 `ConnectivityRecovery.ask` 内为共享 question 创建独立 `AbortController`，
不把首个调用方的 `exec.signal` 传给 `questions.ask`。
仅当该 code 的**所有**等待者都离开（或 gate dispose）时才 abort。

```ts
async ask(code: string, question: (signal: AbortSignal) => Promise<boolean>): Promise<boolean> {
  const inFlight = this.asking.get(code)
  if (inFlight !== undefined) return await inFlight
  const controller = new AbortController()
  // 记录 waiter 计数；最后一个 detach 时 controller.abort()
  const answer = question(controller.signal)
  this.asking.set(code, answer)
  ...
}
```

`withConnectivityAsk` 把 `exec.signal` 用于**自身**的 abort 映射（218 行），
共享 question 的 signal 改由 recovery 提供。

**方案 B — 失败后重试提问**：共享 promise 因 abort 失败时，
仍存活的等待者重新发起一次 `question()`。实现更简单但可能短暂多卡。

**测试**：新增 `tests/unit/ask.spec.ts` 用例：
两个并发 caller 共享同一 code；第一个 caller abort；第二个仍能得到提问并重试。

**验收**：`npx vitest run tests/unit/ask.spec.ts tests/tools/connectivity-ask.spec.ts`

---

### 1.3 I3 `errnoCodeOf` 被 domain code 遮蔽

**文件**：`src/errors.ts:282-296`

**改动**：

```ts
// 跳过 HarnessError 自身的 domain code，继续走 cause
if ('code' in current && typeof current.code === 'string' && current.code !== '') {
  if (!(current instanceof HarnessError)) return current.code
}
// 继续 cause 链
```

（`HarnessError` 已从 `@deepseek-ai/dsh-llm` 导入。）

**测试**：`tests/unit/errors.spec.ts` 补用例：
`new ZoteroError('x', ZOTERO_TIMEOUT, { cause: { code: 'ETIMEDOUT' } })`
→ `errnoCodeOf` 返回 `'ETIMEDOUT'`，`isUnreachableCause` 返回 true。

**验收**：`npx vitest run tests/unit/errors.spec.ts`

---

### 1.4 I4 `waitOrPromote` 在 `registry.start` 拒绝时无前台回退

**文件**：`src/job-runner.ts:336` 附近

**改动**：对齐 `packages/shell/tool-bash/src/index.ts:514-522`：

```ts
let started: { id: JobId; done: Promise<JobOutcome> } | undefined
try {
  started = this.start(wrappedTask)
} catch (error) {
  // registry 拒绝（无 controller / owner 限制）→ 前台执行，与 tool-bash 同形
  const value = await task.run(
    task.exec.signal,
    () => {},
    () => {},
  )
  return { kind: 'foreground', value }
}
const { id, done } = started
```

注意：显式 `run_in_background` 路径（`executeWithJobs` 175 行）**保持 throw**
——用户明确要后台，失败即失败。

**测试**：`tests/unit/job-runner.spec.ts` 补用例：
mock registry.start throw → `waitOrPromote` 返回 foreground 结果。

**验收**：`npx vitest run tests/unit/job-runner.spec.ts`

---

### 1.5 I7 空页 `nextOffset` 原地踏步

**文件**：`src/local/pagination.ts`、`src/local/search-domain.ts:95`

**改动**（fail-loud，与本仓库 changes 域风格一致）：

```ts
// pagination.ts — nextOffsetOf 保持不变（语义正确）
// search-domain.ts:95
const rows = Array.isArray(json)
  ? json
  : (() => {
      throw new ZoteroError('Zotero search returned a non-array body', ZOTERO_UNEXPECTED)
    })()

// 在算 nextOffset 前：
const apiTotal = requireTotalResults(headers, 'items top listing')
if (items.length === 0 && request.offset < apiTotal) {
  throw new ZoteroError(
    `Zotero search returned an empty page at offset ${request.offset} but Total-Results is ${apiTotal}`,
    ZOTERO_UNEXPECTED,
  )
}
```

browse-domain 的 collections/savedSearches/tags 同样处理（`items.length === 0 && offset < total`）。

**测试**：`tests/local/search.spec.ts` 补「空页 + 偏大 total」用例，断言抛 `ZOTERO_UNEXPECTED` 而非返回 `nextOffset === offset`。

**验收**：`npx vitest run tests/local/search.spec.ts tests/local/browse.spec.ts`

---

### 1.6 I6 `resolveNamed` 不校验响应 key

**文件**：`src/local/scope-directory.ts:270-289`

**改动**（对齐 `write-domain.ts:211-215`）：

```ts
const entry = normalizeScopeEntry(json)
if (entry.key !== ref.key) {
  throw new ZoteroError(
    `Zotero answered the scope read with a different object than ${ref.key}; the response cannot be used.`,
    ZOTERO_UNEXPECTED,
  )
}
return {
  ref: refForLibrary(
    ref.library as SupportedLocalLibrary,
    kind,
    entry.key,
    resolveServedBy(headers, claim),
  ),
  name: entry.name,
}
```

**测试**：`tests/local/identity.spec.ts` 或 scope 相关 spec 补「响应 key ≠ 请求 key」用例。

**验收**：`npx vitest run tests/local/identity.spec.ts`

---

### 1.7 I5 BibTeX 条目切分把条目间注释算进 `entry.text`

**文件**：`src/export-mapping.ts:108-133`

**改动**：

```ts
// splitBibtexEntries 中，end 用 entryEndOf 的闭括号位置
for (let index = 0; index < starts.length; index += 1) {
  const start = starts[index]!
  const entryEnd = entryEndOf(text, start.index + /* @type{ 长度 */)
  // 或：在扫描阶段记录 each start 的 entryEnd
  const end = entryEnd  // 不再用 starts[index+1]?.index
  entries.push({
    ...(start.key === undefined ? {} : { key: start.key }),
    start: start.index,
    end,
    text: text.slice(start.index, end).trim(),
  })
}
```

具体实现：扫描循环里已调用 `entryEndOf`（`cursor = Math.max(end, ...)`），
把该 `end` 存进 `starts[i].entryEnd`，切分时用它而非下一起点。

**测试**：`tests/unit/export-mapping.spec.ts` 补用例：
两条目之间夹 `% comment`，断言上一条 `text` 不含该注释，
且 `locateExportItems` 能配对出 `key/start/end`。

**验收**：`npx vitest run tests/unit/export-mapping.spec.ts`

---

## 阶段 2 — 发布门禁

### 2.1 P1 `verify-pack` 覆盖 locale / icon

**文件**：`scripts/verify-pack.mjs:31-48`

**改动**：`expectedPaths` 遍历 `manifest.exports` **全部**条目，
处理 `*` 通配（`./locale/*.json` → 断言 `locale/en.json` 与 `locale/zh.json` 存在），
并加入 `manifest.icon`。

```js
function expectedPaths(manifest) {
  const paths = new Set(['package.json', 'README.md'])
  if (typeof manifest.main === 'string') paths.add(packed(manifest.main))
  if (typeof manifest.icon === 'string') paths.add(packed(manifest.icon))
  for (const [key, value] of Object.entries(manifest.exports ?? {})) {
    if (typeof value === 'string') {
      if (value.includes('*')) {
        // 通配：断言目录下至少 en.json 存在（pack 会列出具名文件）
        if (key.includes('locale')) {
          paths.add('locale/en.json')
          paths.add('locale/zh.json')
        }
      } else {
        paths.add(packed(value))
      }
    } else if (value && typeof value === 'object') {
      for (const v of Object.values(value)) if (typeof v === 'string') paths.add(packed(v))
    }
  }
  const patch = manifest.dsh?.bundle?.patch
  if (typeof patch === 'string') paths.add(packed(patch))
  else if (Array.isArray(patch)) for (const p of patch) paths.add(packed(p))
  return [...paths].sort()
}
```

**验收**：`npm run verify:pack`；临时从 `files` 删 `locale` 应失败。

---

## 阶段 3 — 样式契约（批量，可一次 PR）

**文件**：`src/client/**/*.css`

| 项     | 改动                                                                                                                                                                                                                    |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S1** | 删除 `--dsh-color-danger/warning`；`.errorSummary` → `var(--dsw-alias-state-error-primary)`；`.cautionSummary` → `var(--dsw-alias-state-warn-label)`；徽章三层改 `--dsw-alias-state-*/tertiary`；透明度用 `color-mix()` |
| **S2** | `6px` → 按角色映射 `--dsw-radius-sm` 或 `--dsw-radius-md`；`1px` → `--dsw-radius-xs`；`4px`/`8px` → `--dsw-radius-xs`/`--dsw-radius-sm`                                                                                 |
| **S3** | `border-radius: 50%` 与 `999px` 规则各补 `corner-shape: round`                                                                                                                                                          |
| **S4** | 中性 `border: 1px solid var(--dsw-alias-border-*)` → `0.5px`；inset 环同步                                                                                                                                              |
| **S5** | `toolviews.module.css:224` 去字面量阴影或改 `--dsw-elevation-*` 且去 border；`workspace.module.css:256` 同理                                                                                                            |

**验收**：`npm run build:client`；对照 `docs/web-styling.md` / `docs/ui-radius.md` 自查。

---

## 阶段 4 — 清理（可合并进上述阶段或独立小 PR）

### 4.1 未使用符号（A1）

`tsc -p tsconfig.json --noUnusedLocals --noUnusedParameters` 列出的 16 处 host

- 4 处 client 全部删除（导入、变量、私有函数）。
  `tests/client` 的 4 处同步清理。

### 4.2 死代码 / 死导出（A2/A10）

- 删除 `src/local/changes-domain.ts:92-97` `sameIncludes`
- `src/config.ts` 的 `isSchemaComplete` / `assertResolvedConfig` 去 `export`
- `src/local/pagination.ts:18` 删 `?? headers.get('Total-Results')`

### 4.3 契约说明（A4）

`package.json` 的 `dsh.harnessRange` **保留**（pin 一致性工具有用），
但在 `AGENTS.md` 与 `scripts/harness-state.mjs` 注释中明确：
「本插件内部一致性字段，harness 不读取；真实门槛是 peerDependencies」。

### 4.4 其余建议（按需）

| 项      | 改动                                                             |
| ------- | ---------------------------------------------------------------- |
| A5      | `write-http.ts` 非 401/403/412 时 `response.body?.cancel()`      |
| A6      | 403 Deny 体读取失败 → 抛 `WRITE_AUTH_DENIED` 而非 `API_DISABLED` |
| A7      | `namesAuthority`/`namesLoopback` 比较前 `toLowerCase()`          |
| A8      | `sourceRefs` 走 `assertNonBlank`                                 |
| A9      | `void dispose()` → `return () => dispose()`                      |
| A11     | 布尔字段加 `assertBoolean`                                       |
| A13     | `1000` 提成 `const SETTLE_GRACE_MS`                              |
| A16–A18 | 性能/排序微调                                                    |
| A19–A22 | client 类型/React key/ref 清理                                   |
| A23     | `clsx` 移入 `dependencies`                                       |
| A24–A31 | 注释/脚本/AGENTS.md 文档同步                                     |
| A32     | client 图内统一 `.ts` 导入后缀                                   |

---

## 验证清单（每阶段结束）

```sh
npm run typecheck          # harness-state + 三个 tsc
npm test                   # test-lint + vitest
npm run build:client       # 阶段 3/4 动 client 后
npm run verify:pack        # 阶段 2 后
```

行为变更项（1.1–1.7）需对照 `docs/scenarios.md` 走相关 pack：
写审批 / 连通性提问 / 导出定位 / 搜索分页 / scope 解析。

---

## 建议实施顺序

| 批次 | 内容                           | 预估 |
| ---- | ------------------------------ | ---- |
| PR1  | 阶段 1 全部（I1–I7）+ 对应测试 | 中   |
| PR2  | 阶段 2（verify-pack）          | 小   |
| PR3  | 阶段 3（CSS 批量）             | 中   |
| PR4  | 阶段 4 清理                    | 小   |

不确定项（fulltext `format=versions`、`internal/config` 插值时序）**本计划不改代码**，
列入实机核验 backlog。

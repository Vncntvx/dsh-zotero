<p align="right"><a href="development.en.md"><b>English</b></a></p>

# dsh-zotero 开发指南

## 仓库结构

```
src/
  index.ts              # 插件入口（纯 re-export）
  service.ts            # ZoteroService（Cordis 服务）
  local/provider.ts     # LocalApiProvider（Zotero Local API）
  local/*-domain.ts     # 领域管线（search/export/changes/browse/write 等）+ detail/retrieve/attachment-location
  local/                # 另有 children-wire、note-format、identity、scope-directory、pagination、limits
  http-client.ts        # HTTP 传输层（loopback fetch）
  config.ts             # Config schema 与校验（LOOPBACK_HOSTNAMES 等校验常量）
  types.ts              # 领域类型（DTOs）
  contract.ts           # Remote wire 结构面（类型、端点常量；不含 codec）
  status-codec.ts       # Host 侧严格 codec（zod）；client 对应 src/client/status-codec.ts
  errors.ts             # 错误类与错误码
  json.ts               # 无损 JSON 读取 helper
  constants.ts          # 领域常量（写工具名、authorize 路径、限额等）
  concurrency.ts        # 有界并发
  evidence.ts           # BM25 排名
  search-text.ts        # 与 Zotero normalizeForSearch 对齐的检索折叠
  attachments.ts        # 附件选择
  local/children-wire.ts # Local API 子对象契约：裸 /children（笔记/附件）与 ?itemType=annotation（批注）
  normalize.ts          # Zotero 条目 → 领域 DTO 归一化
  presentation-meta.ts  # 工具结果的展示投影
  refs.ts               # Zotero 对象引用语法
  ref-grammar.ts        # 引用文本模式
  export-items.ts       # 逐文档导出解析
  export-mapping.ts     # 引用 → 批量条目映射
  ask.ts                # 连接失败时的 user-question 交互（每类故障一次提问，并行调用共享同一张卡）
  prompt.ts             # 面向模型的 policy section
  command.ts            # /zotero 命令（status 为等价写法）
  write-approval.ts     # 写入计划卡（ctx.zotero 接缝的确认层）
  write-auth.ts         # Zotero 本地写 key 的获取与持久化
  write-http.ts         # Local API 写传输（Server-ID + key + 批量）
  shell-write-detector.ts # shell 直写本地 API 的检测（tools/pre-execute → ask）
  remote.ts             # Web tab 的 Remote 服务
  typert.ts             # Typert manifest
  settings-namespace.ts # 设置命名空间常量
  tools/                # 11 个模型工具（8 个读取 + create_note/add_tags/add_to_collection 三个写入）+ present/validate 共享件
  client/               # 浏览器端（设置页、Sources tab、sources 归约、workspace 视图）
tests/                  # 单元测试（mock Zotero server + 浏览器设置页测试）
```

## 安装与构建

```sh
npm install                  # 本仓库与 deepseek-harness 并列，仅嵌套副本才加 --no-workspaces
npm test                     # 单元测试（mock Zotero server + browser card tests）
npm run typecheck            # 上游依赖状态检查 + tsc --noEmit（node/test/client projects）
npm run build                # tsc + esbuild（node lib/ + browser lib/client.js）
npm run build:client         # 仅重新构建浏览器端
npm run test:coverage        # 覆盖率门禁（全局 97/95/98/97 + 分层 ratchet，见 vitest.config.ts）
npm run harness:check        # 上游版本钉与声明新鲜度（typecheck 已内置这一步）
npm run harness:pin -- <ver> # 把版本钉整体移到 <ver>（devDeps/overrides/peers/engines/README/AGENTS）
npm run verify:pack          # 打包产物门禁（tarball 必含入口与 cordis.patch.yml）
npm run format               # prettier --write
npm run format:check         # 格式化检查
```

> 本仓库与 deepseek-harness 并列为 sibling 目录（见 AGENTS.md），直接 `npm install`；只有把它嵌套进 harness workspace 副本时才加 `--no-workspaces`。
>
> 上游**类型**来自 `node_modules/@deepseek-ai/*` 符号链接所指向的 sibling checkout 的 `lib/types` 构建产物（与发布版消费者的读取方式一致）。sibling 的 `git pull` 不会重建它们，因此 `npm run typecheck` 先跑 `node scripts/harness-state.mjs`：某个被导入的包其 `src` 比声明文件更新时，它会给出需要执行的构建命令。`npm run harness:check -- --strict`（发布检查用）把这一项从提示升级为失败。

## 集成测试

```sh
npm run test:integration
# 或: ZOTERO_INTEGRATION=1 npx vitest run tests/integration/zotero.integration.spec.ts
```

需要本地 Zotero 运行在 `127.0.0.1:23119`。

## 两部分构建

- **Node 端**（lib/）：tsc 从 TypeScript 生成，包含 service、tools、provider、transport。
- **浏览器端**（lib/client.js）：esbuild 生成，包含设置页和 Sources tab 视图。

## 本地开发

### 从 dsh 源码构建

```sh
pnpm install && pnpm run build   # 先构建 dsh
pnpm dsh web --patch ./dsh-zotero/dev.cordis.yml
```

### 使用 npm 安装的 dsh

三种方式：

1. **Tarball 安装验证**：

```sh
npm pack
dsh plugin --profile <name> add ./dsh-zotero-*.tgz
cd ~/.dsh/profiles/<name>
node --input-type=module < /path/to/dsh-zotero/scripts/smoke.mjs
```

2. **Node 端热替换**：

```sh
npm run dev &                     # tsc --watch
dsh web --patch ./dev-lib.cordis.yml --port 3307
```

3. **浏览器端开发**：

```sh
npm run dev:client                # esbuild watch
# 需先将 checkout 安装到 profile 中浏览器端才会加载
```

## 测试

- 单元测试使用 MockZotero（mock HTTP server）
- 浏览器设置页测试使用 jsdom + @testing-library/react
- 覆盖率门禁见 `vitest.config.ts`：全局 97 语句 / 95 分支 / 98 函数 / 97 行，并按层设 ratchet（`src/*.ts`、`src/local/**`、`src/tools/**`、`src/client/**` 等）。纯类型/重导出模块列入 exclude（`src/index.ts`、`src/types.ts`、`css-modules.d.ts`、`sources/model.ts` 等）
- 集成测试运行在真实 Zotero 上，默认跳过

## 发布检查清单

- `npm run harness:check -- --strict` 通过（版本钉一致，且上游声明不落后于 sibling 源码）
- `npm run verify:pack` 通过（tarball 含 `lib/index.js`、`lib/index.d.ts`、`lib/client.js`、`cordis.patch.yml`）
- `npm test` 通过
- `npm run typecheck` 通过
- `npm run test:coverage` 通过（门禁见上）
- `npm run format:check` 通过
- `npm run build` 成功
- tarball 安装后 smoke.mjs 通过
- 有 Zotero 时集成测试通过
- 按 [使用情景](scenarios.md) 跑过金路径（G1–G8）；启用写入时再跑 W1–W4

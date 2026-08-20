<p align="right"><a href="development.en.md"><b>English</b></a></p>

# dsh-zotero 开发指南

## 仓库结构

```
src/
  index.ts              # 插件入口（纯 re-export）
  service.ts            # ZoteroService（Cordis 服务）
  provider-local.ts     # LocalApiProvider（Zotero Local API）
  http-client.ts        # HTTP 传输层（loopback fetch）
  config.ts             # Config schema 与校验
  types.ts              # 领域类型（DTOs）
  errors.ts             # 错误类与错误码
  evidence.ts           # BM25 排名
  attachments.ts        # 附件选择
  refs.ts               # Zotero 对象引用语法
  export-items.ts       # 逐文档导出解析
  export-mapping.ts     # 引用 → 批量条目映射
  prompt.ts             # 面向模型的 policy section
  command.ts            # /zotero status 命令
  remote.ts             # Web tab 的 Remote 服务
  typert.ts             # Typert manifest
  settings-namespace.ts # 设置命名空间常量
  tools/                # 5 个工具实现
  client/               # 浏览器端（设置卡片、Sources tab）
tests/                  # 单元测试（mock Zotero server）
```

## 安装与构建

```sh
npm install --no-workspaces  # 本仓库位于 deepseek-harness workspace 内
npm test                     # 单元测试（mock Zotero server + browser card tests）
npm run typecheck            # tsc --noEmit（node/test/client projects）
npm run build                # tsc + esbuild（node lib/ + browser lib/client.js）
npm run build:client         # 仅重新构建浏览器端
npm run test:coverage        # src/ 100% 覆盖率
npm run format               # prettier --write
npm run format:check         # 格式化检查
```

> 本仓库嵌套在 deepseek-harness workspace 中，必须使用 `npm install --no-workspaces`。

## 集成测试

```sh
npm run test:integration
# 或: ZOTERO_INTEGRATION=1 npx vitest run tests/integration/zotero.integration.spec.ts
```

需要本地 Zotero 运行在 `127.0.0.1:23119`。

## 两部分构建

- **Node 端**（lib/）：tsc 从 TypeScript 生成，包含 service、tools、provider、transport。
- **浏览器端**（lib/client.js）：esbuild 生成，包含设置卡片和 Sources tab 视图。

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
- 浏览器卡片测试使用 jsdom + @testing-library/react
- src/ 100% 覆盖率（src/index.ts 和 src/types.ts 除外）
- 集成测试运行在真实 Zotero 上，默认跳过

## 发布检查清单

- `npm test` 通过
- `npm run typecheck` 通过
- `npm run test:coverage` 通过（100%）
- `npm run format:check` 通过
- `npm run build` 成功
- tarball 安装后 smoke.mjs 通过
- 有 Zotero 时集成测试通过

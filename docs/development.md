<p align="right"><a href="development.en.md"><b>English</b></a></p>

# 开发指南

## 仓库结构

```text
src/
  index.ts              # 插件入口（纯 re-export）
  service.ts            # ZoteroService（Cordis 服务）
  local/provider.ts     # LocalApiProvider（Zotero Local API 适配）
  local/*-domain.ts     # 领域管线（search、export、changes、browse、write 等）
  local/                # 辅助模块：detail、retrieve、attachment-location、scope-directory 等
  http-client.ts        # HTTP 传输层（环回 fetch、流式与并发槽位控制）
  config.ts             # 配置 Schema 与校验逻辑
  types.ts              # 领域 DTO 与类型定义
  contract.ts           # Remote wire 协议面与常量
  diagnostics.ts        # 进程内诊断环形缓冲、条目模型与接收器
  status-codec.ts       # Host 端状态解码（zod）
  abort.ts              # 调用方取消错误的唯一拼写（harness TOOL_ABORTED）
  errors.ts             # 错误类与错误码
  json.ts               # 无损 JSON 读取辅助函数
  evidence-item.ts      # 原文片段投影定义（端侧共享）
  browse-rows.ts        # 浏览行分类（端侧共享）
  changes-contract.ts   # changes 投影的共享 wire 描述符
  projection-keys.ts    # zoteroStatus 投影键与类型合并（端侧共享）
  session-events.ts     # zotero/status 会话事件与状态→wire 视图折叠
  status-projection.ts     # zoteroStatus 会话投影单元（last-value fold）
  transport-bounds.ts      # 本地与学术两套传输共用的响应体上限判定
  transport-diagnostics.ts # 传输层诊断行记录（请求行、取消与降级）
  constants.ts             # 常量定义
  concurrency.ts        # 有界并发控制器
  job-runner.ts         # 重型工具的 ctx.jobs 后台任务适配
  evidence.ts           # BM25 排序算法
  search-text.ts        # 与 Zotero normalizeForSearch 一致的搜索折叠
  attachments.ts        # 附件选择与优先级逻辑
  normalize.ts          # Zotero 响应至领域 DTO 的归一化转换
  presentation-meta.ts  # 工具结果的展示投影
  refs.ts               # Zotero ref 语法解析与格式化
  ref-grammar.ts        # 引用语法校验模式
  export-items.ts       # BibTeX 条目键语法与字段提取
  export-mapping.ts     # 引用与批量条目映射
  prompt.ts             # 面向模型的系统提示词
  command.ts            # /zotero 状态命令
  write-approval.ts     # 写入双层确认（审批策略与计划审查卡）
  write-auth.ts         # Zotero 本地写入密钥获取与持久化
  write-http.ts         # 本地写入 HTTP 请求处理
  write-item-rules.ts   # 写入字段与更新规则（工具与写域共享）
  shell-write-detector.ts # 直写本地 API 的 shell 命令拦截检测
  remote.ts             # Web 端 Remote 服务
  typert.ts             # Typert 清单
  settings-namespace.ts # 设置命名空间常量
  tools/                # 23 个本地模型工具定义（8 读 + 15 写）
  tools/degradable.ts   # 写工具计划预览的降级规则（不可达/歧义才降级）
  client/               # 浏览器端（配置页、Sources 面板、工具卡片视图）
tests/                  # 单元测试与端到端测试用例
```

## 安装与构建

```sh
npm install                  # 依赖安装（与 deepseek-harness 并列）
npm test                     # 单元测试与测试规范检查
npm run typecheck            # 类型检查（包含 Node、测试与浏览器端工程）
npm run build                # 编译全部产物（tsc → lib/，esbuild → lib/client.js）
npm run build:client         # 仅构建浏览器端产物
npm run test:coverage        # 覆盖率门禁检查
npm run harness:check        # 检查上游 Harness 版本钉与产物一致性
npm run harness:pin -- <ver> # 统一更新 Harness 依赖版本钉
npm run verify:pack          # 校验打包产物文件完整性
npm run smoke                # 生产栈冒烟：在 dsh profile 内对真实 Zotero 调用全部读工具
npm run smoke:discovery      # 打包产物 → 临时 profile → dsh web 启动探针
npm run release:branch       # 切出可发布的 release 分支（清单驱动）
npm run release:check        # 发布门禁：格式、版本钉、测试、类型、覆盖率、构建、打包
npm run link:local-harness   # 将 @deepseek-ai/dsh-* 依赖链接到 sibling 检出
npm run dev                  # 监听 Node 端源码并增量编译
npm run dev:client           # 监听浏览器端源码并增量打包
npm run lint:test            # 仅运行测试规范守卫
npm run test:watch           # vitest watch 模式
npm run format               # 执行 Prettier 格式化
npm run format:check         # 检查代码格式
```

`prepare`（npm install 时触发）从源码构建 `lib/`；`prepublishOnly` 在发布前运行 `release:check`。

说明：本仓库通常与 `deepseek-harness` 作为 sibling 目录并列开发。类型定义通过符号链接读取上游构建产物。若上游代码发生更新，需先在上游执行构建以同步声明文件。

发布版的 `@deepseek-ai/dsh-client-*` 把第三方运行时依赖声明在自身的 `devDependencies`（由 shell 打包时提供），并在 `lib/` 中直接引用 `.module.css`。因此本仓库在 `devDependencies` 中补齐这些第三方依赖，`vitest.config.ts` 把 `@deepseek-ai/dsh-client-*` 列为内联依赖，使只有 registry 安装、没有 sibling 的环境（CI）也能运行客户端测试车道。

### 上游产物一致性门禁

`npm run harness:check` 检查上游构建产物是否过期。两项检查互相独立。

1. 声明与源码：检查 `lib/types/*.d.ts` 是否晚于对应的上游源码，防止类型检查对着不是当前源码编译出来的接口。补救命令是重建声明与 Node 端产物。
2. 浏览器运行时与声明：检查客户端包的 `lib/client.js` 是否晚于其客户端声明，防止页面加载的运行时落后于编译器读到的声明。补救命令是只重建浏览器产物。

```sh
pnpm --dir ../deepseek-harness run build             # 第 1 项：重建声明与 Node 端产物
pnpm --dir ../deepseek-harness run build:lib:client   # 第 2 项：只重建浏览器产物
```

不带 `--strict` 时，两项检查输出 note（提示）。带 `--strict` 时（`release:check` 使用此模式），两项都升级为 problem（拦截）。声明文件缺失则在两种模式下都是 problem，因为类型检查根本解析不到。

同一脚本还校验 vendored 框架包：`dependencies` / `devDependencies` / `peerDependencies` 中 `cordis`、`cosmokit`、`schemastery`、`cordis-plugin-*` 的区间下界，必须等于 sibling `vendor/<pkg>/package.json` 的 version，不符时两种模式都直接失败。这类包不跟随 Harness 版本钉，下界写成 `^X.Y.Z-alpha.N` 会在同一个 profile 里留下两份 `cordis`。

## 集成测试

```sh
npm run test:integration
```

集成测试需要本地 Zotero 运行在 `127.0.0.1:23119` 并启用本地 API 通信。

## 构建产物

- Node 端产物（`lib/`）：由 `tsc` 编译生成，包含服务逻辑、工具定义、Provider 与传输层；
- 浏览器端产物（`lib/client.js`）：由 `esbuild` 打包生成，包含配置页、Sources 面板与会话卡片。

## 本地调试

### 完整插件调试（含 Web 界面）

```sh
export DSH_HOME=$(mktemp -d /tmp/dsh-zotero-dev-XXXX)
cp ~/.dsh/.credentials.yaml "$DSH_HOME/"   # 仅预置写入凭据；插件配置见块后说明
chmod 600 "$DSH_HOME/.credentials.yaml"
npm run build
dsh plugin --profile web add .
npm run dev &        # 监听 Node 端变更
npm run dev:client & # 监听浏览器端变更
cd ../deepseek-harness && env DSH_HOME="$DSH_HOME" \
  node --import tsx/esm apps/cli/src/bin.ts web --port 3307
```

> 说明：alpha.4 起插件配置持久化在当前 profile 的 `cordis.patch.yml`（`zotero` 条目），`~/.dsh/settings.yaml` 只会在启动时被一次性导入。Zotero 连接等配置首次在临时实例的插件管理器中打开 **dsh-zotero** 配置区填写一次即可（也可从现有 profile 的 `cordis.patch.yml` 拷入 `zotero` 条目的 `config`）。

> 学术组件：随包发布的 `dsh-zotero/scholarly` 行默认关闭，开关只有这一处。两份叠加层模板（`dev.cordis.yml.example` / `dev-lib.cordis.yml.example`）都会挂载学术组件，本地调试无需先在插件管理器里打开该行；在真实 profile 中调试时，在「包含的组件」中启用该行即可，工具与设置页即时生效，无需重启。

### 仅 Host 端调试（支持 HMR）

```sh
npm run build                                    # 首次构建 lib/ 目录
npm run dev &                                    # 监听并自动增量编译至 lib/
cp dev-lib.cordis.yml.example dev-lib.cordis.yml # 复制叠加层模板并配置实际绝对路径
dsh web --patch ./dev-lib.cordis.yml --port 3307
```

> 注意：`dev-lib.cordis.yml` 叠加层通过配置构建入口的绝对路径（`<absolute-path-to-dsh-zotero>/lib/index.js`）加载插件，使得 Host 端（模型工具与 `/zotero` 命令行）能在 Loader 监视下实现免重启热重载；但 Harness 客户端模块加载器仅解析已注册的裸包名，因此该模式不加载浏览器端前端组件（配置页与 Sources Tab）。如需调试前端 UI，请使用上述「完整插件调试」流程（`dsh plugin --profile web add .` 与 `npm run dev:client`）。

### 诊断面板与诊断包

排查插件运行问题时，可在配置区开启「开启诊断」后，在插件详情页底部的「诊断」卡片中查看运行时状态与日志：

- **日志收集与过滤**：开启诊断后，收集并保留相关条目，支持按级别筛选（「仅问题」筛选 warn 与 error）。条目按时间倒序排列，连续出现的重复记录会自动合并计数；
- **诊断模式**：在 dsh-zotero 配置区的「诊断」配置组中开启「开启诊断」并保存后，详情页底部即展示诊断面板并记录详细排障日志；
- **前端异常捕获**：前端界面（Sources 标签页、工具卡片、详情面板等）发生渲染崩溃时，错误边界会自动记录异常信息，并在 `surface` 字段标明触发位置（如 `sources`、`tool:zotero_search`）；
- **导出诊断包**：点击「复制诊断信息」可生成包含插件版本、Zotero 端点与版本、debug 状态及全部缓冲记录的文本包，便于粘贴至问题报告。

## 测试规范

- 单元测试运行于模拟 Zotero HTTP 服务（MockZotero）上；
- 浏览器配置页测试基于 JSDOM 与 `@testing-library/react`；
- 覆盖率阈值定义在 `vitest.config.ts` 中，对各核心分层分别设置门禁指标；
- 集成测试针对真实运行的 Zotero 实例验证网络协议与真实数据。

## 发布检查清单

`package.json` 的 `release:check` 定义了发布门禁。下列第 1 至 7 步由该脚本按顺序执行，任一步失败即中断；第 8 项为脚本之外的人工验证：

1. `npm run format:check`：Prettier 格式检查；
2. `npm run harness:check -- --strict`：版本钉、上游声明与 vendored 框架版本须对齐，过期产物在该模式下变为错误（`release:check` 直接以 `node scripts/harness-state.mjs --strict` 调用同一脚本）；
3. `npm run lint:test`：测试规范守卫（lane、`.only`/`.skip`、spec 行数棘轮）；
4. `npm run typecheck`：Node、测试与浏览器端三个工程的类型检查；
5. `npm run test:coverage`：全量 vitest 测试与分层覆盖率门禁；
6. `npm run build`：生产构建（`tsc` → `lib/`，esbuild → `lib/client.js`）；
7. `npm run verify:pack`：校验打包 tarball 的必需文件；
8. 人工验证 [使用场景](scenarios.md) 中的主流程用例（G1 至 G8），若启用写入需验证 W1 至 W9。

`npm test` 与发布门禁不等价：它执行 `node scripts/test-lint.mjs` 加 `vitest run`（不跑覆盖率门禁），是日常回归命令；发布路径把这两件事分别交给第 3 步和第 5 步。

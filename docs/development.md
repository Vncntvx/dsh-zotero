<p align="right"><a href="development.en.md"><b>English</b></a></p>

# 开发指南

## 仓库结构

```text
src/
  index.ts              # 插件入口（纯 re-export）
  service.ts            # ZoteroService（Cordis 服务：工具接线与 Provider 生命周期）
  service-config.ts     # 传输重建配置键与 LocalApiLimits 映射
  service-lifecycle.ts  # 配置提交校验与 volatile 更新处理
  shell-write-approval.ts # shell 直写本地 API 的审批接缝
  subagent-guard.ts     # 子 agent 写策略：按会话血缘收缩写工具可见性并在执行期拒绝其写调用
  tool-diagnostics.ts   # 工具执行诊断记录
  tool-registration.ts  # 读/写工具注册清单
  skills/               # Host 端按需研究 SOP：定义、Recipe、组件分层注册；维护与验证见 skills.md
  library/              # 文献面板子组件（ZoteroLibraryService、配置 schema）
  library-views.ts      # 文献面板 wire 视图与域请求的双向映射（含 export）
  library-write.ts      # 文献面板写入口：进入注册工具管线与审批接缝
  local/provider.ts     # LocalApiProvider（Zotero Local API 适配）
  local/*-domain.ts     # 领域管线（search、export、changes、browse、write 等）
  local/                # 辅助模块：detail、retrieve、retrieve-fulltext、attachment-location、scope-directory、scope-paths、search-index、search-query、item-schema-directory、changes-cursor、item-batch 等
  local/write-*.ts      # 写域模块：write-domain 与 batch、collections、item-lists、library-maintenance、notes、refs、saved-searches、verdicts、deps
  http-client.ts        # HTTP 传输层（环回 fetch、流式与并发槽位控制）
  config.ts             # 配置 Schema 与校验逻辑
  types.ts              # 领域 DTO 与类型定义
  contract.ts           # Remote wire 协议面与常量
  wire-schemas.ts       # 双端共用的 wire 边界 zod schema
  creators.ts           # 作者显示格式（端侧共享）
  media-types.ts        # 媒体类型常量（端侧共享）
  diagnostics.ts        # 进程内诊断环形缓冲、条目模型与接收器
  wire-schemas.ts       # Host 与客户端共享的严格 wire schema（zod）
  abort.ts              # 调用方取消错误的唯一拼写（harness TOOL_ABORTED）
  errors.ts             # 错误类与错误码
  json.ts               # 无损 JSON 读取辅助函数
  evidence-item.ts      # 原文片段投影定义（端侧共享）
  browse-rows.ts        # 浏览行分类（端侧共享）
  changes-contract.ts   # changes 投影的共享 wire 描述符
  transport-bounds.ts      # 本地与学术两套传输共用的响应体上限判定
  transport-diagnostics.ts # 传输层诊断行记录（请求行、取消与降级）
  constants.ts             # 常量定义
  concurrency.ts        # 有界并发控制器
  job-runner.ts         # 重型工具的 ctx.jobs 后台任务适配
  evidence.ts           # BM25 排序算法
  search-text.ts        # 与 Zotero normalizeForSearch 一致的搜索折叠
  attachments.ts        # 附件选择与优先级逻辑
  normalize-children.ts # 笔记、批注与附件子行的归一化
  normalize-context.ts  # 归一化共享的身份与文本规则
  normalize-item-detail.ts # 条目详情与其子列表的归一化
  normalize-saved-search.ts # 保存检索条件的归一化
  normalize-scope.ts    # 合集/保存检索身份条目的归一化
  normalize-search.ts   # 搜索命中与共享条目事实的归一化
  presentation-meta.ts  # 工具结果的展示投影
  refs.ts               # Zotero ref 语法解析与格式化
  ref-grammar.ts        # 引用语法校验模式
  export-items.ts       # BibTeX 条目键语法与字段提取
  export-mapping.ts     # 引用与批量条目映射
  export-limits.ts      # zotero_export 与文献面板 export 端点共用的引用条数上限校验
  prompt.ts             # 面向模型的系统提示词
  write-approval.ts     # 写入双层确认（审批策略与计划审查卡）
  write-auth.ts         # Zotero 本地写入密钥获取与持久化
  write-http.ts         # 本地写入 HTTP 请求处理
  write-item-rules.ts   # 写入字段与更新规则（工具与写域共享）
  shell-write-detector.ts # 直写本地 API 的 shell 命令检测（命中转审批，best-effort）
  remote.ts             # Web 端 Remote 服务
  typert.ts             # Typert 清单
  settings-namespace.ts # 设置命名空间常量
  tools/                # 23 个本地模型工具定义（8 读 + 15 写）
  tools/degradable.ts   # 写工具计划预览的降级规则（不可达/歧义才降级）
  client/               # 浏览器端（设置页、文献轨迹、文献面板、工具卡片视图）
tests/                  # 单元测试与端到端测试用例
```

## 文档资产

`docs/` 下的中文文档与 `.en.md` 英文文档成对维护，修改一侧必须同步另一侧；术语与边界以 [产品模型](product-model.md) 为准。

| 文档                             | 内容                                                         |
| -------------------------------- | ------------------------------------------------------------ |
| [快速入门](getting-started.md)   | 安装、前置条件与连接验证                                     |
| [产品模型](product-model.md)     | 两个入口、两大视图、组件分工与系统边界：命名与边界的唯一来源 |
| [功能概览](features.md)          | 对话能力、文献轨迹、文献面板、写入与学术检索                 |
| [研究 SOP 技能](skills.md)       | 八个按需研究流程、批处理预算与证据边界                       |
| [工具参考](tools.md)             | 23 个本地工具（8 读 + 15 写）与 7 个学术检索工具             |
| [配置参考](configuration.md)     | 四个设置命名空间、69 个字段与热更新机制                      |
| [故障排查](troubleshooting.md)   | 常见问题、原因与排查步骤                                     |
| [系统架构](architecture.md)      | 数据流、分层职责与设计边界                                   |
| [开发指南](development.md)       | 构建、测试、调试与发布流程                                   |
| [开发留意](development-notes.md) | 未来开发需要复核的约束、行为边界与迁移事项                   |
| [文档索引](index.md)             | 读者文档入口                                                 |

产品结构与术语见 [产品模型](product-model.md)；代理与贡献者规则见仓库根部的 `AGENTS.md`。

## 安装与构建

```sh
npm install                  # 依赖安装（与 deepseek-harness 并列）
npm test                     # 单元测试与测试规范检查
npm run typecheck            # 类型检查（包含 Node、宿主测试、浏览器端、浏览器测试与 CLI 工程）
npm run build                # 编译全部产物（tsc → lib/，esbuild → lib/client.js）
npm run build:client         # 仅构建浏览器端产物
npm run test:coverage        # 覆盖率门禁检查
npm run test:calibration     # 语义标定自检（离线协议，不加载模型）
npm run harness:check        # 检查上游 Harness 版本钉与产物一致性
npm run harness:pin -- <ver> # 统一更新 Harness 依赖版本钉
npm run deps:check           # 查询 registry，列出落后于最新版的直接依赖
npm run verify:pack          # 校验打包产物文件完整性（含包内语义运行时资产的哈希与许可）
npm run assets:semantic      # 下载并校验钉定的本地语义模型到 ~/.dsh/models
npm run assets:runtime       # 从 devDependency 重新生成包内语义运行时资产
npm run smoke -- --profile-dir <profile目录> # 已安装 profile + dsh 运行时，对真实 Zotero 执行八个只读入口
npm run smoke:scholarly      # 需联网的手动 scholarly_get 冒烟，使用生产 DNS/undici/TLS 栈
npm run smoke:discovery      # 打包产物 → 临时 profile（无需构建批准）→ dsh web 启动探针
npm run smoke:web-composition # 在 smoke:discovery 之上追加浏览器组合验收
npm run release:branch       # 切出可发布的 release 分支（清单驱动）
npm run release:check        # 发布门禁：格式、版本钉、测试、类型、覆盖率、构建、打包
npm run link:local-harness   # 将 @deepseek-ai/dsh-* 依赖链接到 sibling 检出
npm run dev                  # 监听 Node 端源码并增量编译
npm run dev:client           # 监听浏览器端源码并增量打包
npm run lint:hooks           # React Hook 顺序与依赖；告警也拦截发布
npm run lint:test            # 仅运行测试规范守卫
npm run style:check          # 客户端样式守卫，对照宿主设计 token 快照
npm run tokens:write         # 宿主升级后刷新样式 token 快照
npm run test:watch           # vitest watch 模式
npm run test:integration     # 对运行在 127.0.0.1:23119 的真实 Zotero 执行只读集成测试
npm run format               # 执行 Prettier 格式化
npm run format:check         # 检查代码格式
```

`prepare`（npm install 时触发）从源码构建 `lib/`；`prepublishOnly` 在发布前运行 `release:check`。

解析阅读器的快照、文件读取和 Worker 行为由 `tests/host/enrichment-read-*`、`enrichment-artifact-*` 与 `enrichment-archive-worker` 覆盖；浏览器资源所有权、完整图文发布及交互由 `tests/client/library/parsed-document-*` 和 `parsed-resource-composition` 覆盖。`verify:pack` 会从实际 npm tarball 执行生成的 JS Worker。构建后可运行 `node scripts/smoke-parsed-ui.mjs`，在 Chromium 中检查真实组件的亮暗、窄宽布局、选区菜单和完整刷新；该脚本使用受控远程响应。`node scripts/measure-parsed-archive.mjs` 对同一份含 128 MiB 图片的合成归档，比较同步解包与 Worker 的主线程延迟，报告写入 `/tmp/dsh-zotero-archive-performance.json`。这两项检查不调用 Zotero 或 MinerU，实时上传仍须单独验收。

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

### pin 升级复核清单

`npm run harness:pin -- <ver>` 从上游目标标签更新版本快照和 consumer 清单。随后刷新两份 lockfile，再运行 `harness:check`。上游标签可用时，该检查也核对来源提交和 `packageManager`。

```sh
npm install --package-lock-only
npm install --package-lock-only --prefix tests/fixtures/dsh-cli-consumer
npm run harness:check
```

升级时还要复核本仓库镜像的上游语义。

```sh
pin=$(node -p "require('./package.json').devDependencies['@deepseek-ai/dsh-agent']")
git -C ../deepseek-harness grep -n -E 'data-plugin-css|ClientBundleRegistration|claimStyles' "dsh-v$pin" -- packages/client/tsdown.client.ts packages/client/modules/src/client
git -C ../deepseek-harness show "dsh-v$pin:packages/client/ui-chat/src/client/contract/chat-nodes.ts" | rg -n 'export function isSettledTool' -A 3
git -C ../deepseek-harness show "dsh-v$pin:packages/client/ui-tool/src/client/tool/models/tool-call-model.ts" | rg -n 'export function resultText' -A 13
```

`isSettledTool` 由上游 `@deepseek-ai/dsh-client-ui-chat/client` 公开导出，`resultText` 没有公开入口，两个镜像都在 host 半被复用，因此不能改成值导入。上游实现若有变化（尤其是"空内容 + 错误"的回退、"preparing" 的判定），同步 `tests/client/presenters.spec.ts` 的退化矩阵。

## 集成测试

```sh
npm run test:integration
```

集成测试需要本地 Zotero 运行在 `127.0.0.1:23119` 并启用本地 API 通信。

## 语义准入档位（固化在代码中）

每档的 `floor`（绝对余弦门槛）与 `margin`（相对最高余弦的容差）位于 `src/enrichment/semantic/model-profiles.ts`。安装好模型包即可工作；未知档位按 `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE` 明确失败。

2026-11-17 使用六档 pinned ONNX 包，经生产 worker 实际编码，原始向量与完整报告归档在 `tests/fixtures/semantic-admission/`。数据是 `tests/helpers/semantic-recall-fixtures.ts` 的 24 个手工编写回归例：20 个改写、2 个词面和 2 个重复控制例，每例 8 段，其中 1 段为标注答案；english 仅使用 12 个英文例，其中改写 10 个。移除各例答案后的 7 段构成无关对照语料。它与 `semantic-calibration/` 的五特征 logistic 数据集是两套协议。

| 档位        |    floor | margin | 改写例数 | 改写 recall@4 | 改写 MRR | 对照语料命中 |
| ----------- | -------: | -----: | -------: | ------------: | -------: | -----------: |
| balanced    |    0.427 |   0.12 |       20 |           90% |      0.9 |         0/24 |
| lightweight |    0.797 |   0.02 |       20 |           55% |     0.55 |         0/24 |
| bilingual   |    0.515 |   0.12 |       20 |           90% |      0.9 |         0/24 |
| english     |    0.593 |   0.12 |       10 |           80% |      0.8 |         0/12 |
| hybrid      | 0.509118 |   0.12 |       20 |           90% |      0.9 |         0/24 |
| academic    |    0.584 |   0.12 |       20 |           95% |     0.95 |         0/24 |

同一批改写问题上，BM25 的答案 recall@4 为 0%；完整回归集包含词面控制例，BM25 recall@4 为 4/24（english 为 2/12），两个分母不能混用。`margin` 是固定策略值，本次未声称独立拟合得到最优 margin。所有当前 floor 均高于实测移除答案对照的最高余弦；hybrid 的 0.509118 按实测最高余弦 0.508117562 加 0.001 安全距离取整，替换曾放进两条无关对照的旧值 0.461，本组改写召回不变。

这些结果描述同组回归检查，不构成外部独立标注、真实 PDF 提取、heldout 效果或生产误命中率保证。档位仍可漏召回。报告列出模型 identity、输入摘要、向量文件 SHA-256、逐例余弦、语义与 BM25 排名；自动测试只复算归档向量，不加载模型、不联网。

重新测量使用以下完整流程；编码是明确的手工模型执行，其余步骤只读本地数据：

```sh
npm run build
npm run assets:semantic -- --model=<key> --dir=<model-root>
node scripts/semantic-calibration/prepare-admission.mjs > /tmp/admission-input.json
node scripts/semantic-calibration/encode-admission.mjs --request /tmp/admission-input.json --model <key> --dir <model-root> --out /tmp/<key>-vectors.json
node scripts/semantic-calibration/measure-admission.mjs --embeddings /tmp/<key>-vectors.json > /tmp/<key>-report.json
```

编码输出以独占创建保存，重复执行应选择新的输出路径。测量报告同时提供显式的 floor/margin 候选及支持范围，须结合逐例结果复核后再修改策略、更新归档向量和报告。`fit.mjs` 的 logistic 阈值不用于生成 cosine floor。`self-check.mjs` 与 `validate.mjs` 仍只验证独立的离线拟合协议。

## 构建产物

- Node 端产物（`lib/`）：由 `tsc` 编译生成，包含服务逻辑、工具定义、Provider 与传输层；
- 浏览器端产物（`lib/client.js`）：由 `esbuild` 打包生成，包含设置页、文献轨迹、文献面板与会话卡片。

## 工程约束

- **构建与发布身份**：`scripts/build-state.mjs` 在完整 build/prepare 后记录源文件、脚本、配置、lockfile、工具链与全部产物的摘要；release artifact 是去掉脚本、开发依赖与开发用 overrides 的单一 tarball。`release-artifact.mjs`、`release-tar.mjs` 与 `publish-release-branch.mjs` 绑定源 SHA、文件闭集、逐文件摘要、tarball 摘要与包内内容；publish 作业以读取到的旧 ref 作 CAS lease，来源回退和字节变化都被拒绝。验证：`build-state.spec.ts`、`release-artifact.spec.ts`、`release-branch.spec.ts`、`release:check`。
- **样式 token 来源**：CI 用 lockfile 安装的精确 theme 源码核对 dsw/ds，链接开发用 sibling 的 pin tag；`scripts/style-tokens.mjs` 的 `RUNTIME_SEAMS` 逐项对应当前 pin 的设置、CSS 定义或 `setProperty` 调用，来源表与快照闭合。验证：`tokens:check`（在 `release:check` 中）、`style-tokens.spec.ts`。
- **客户端平台清单**：`scripts/client-graph-authority.mjs` 在 sibling 在场时用 TypeScript AST 读取 pin tag 的 `PLATFORM_MODULES`，逐项拒绝宿主未提供的 external；无 sibling 的注册表检查由固定输入的门禁测试覆盖。手动 UI 验收复用 `pinnedHarness`/`pinThemeSheets`，记录 DOM、控制台错误与截图。验证：`client-graph-authority` 变异测试、`harness:check`、`smoke-parsed-ui.mjs`。
- **React Hook 与脚本类型**：客户端源码与浏览器测试执行 `rules-of-hooks` 与 `exhaustive-deps`，任何告警使 `lint:hooks` 失败；Babel 解析 TS/JSX，`.ts` 保持无 JSX 语义；`tsconfig.scripts.json` 以 `checkJs` 检查 `scripts/` 下的全部 `.mjs`；`typecheck:after-build` 在 build 之后运行，覆盖其余四个工程的类型检查。验证：`react-hooks.spec.ts`、`harness-artifacts.spec.ts`、`npm run lint:hooks`、`npm run typecheck`。
- **样式门禁**：`scripts/shared/css-syntax.mjs` 用 CSSTree 解析规则、声明、选择器与媒体条件；字体字面量必须来自宿主阶梯，颜色包括命名色、现代函数与变量 fallback，hover 与触屏字号条件在相反能力下必须不匹配，减少动态效果须实际把 transition/animation 置 none。验证：`style-syntax.spec.ts`、`npm run style:check`。
- **依赖与运行时身份**：ONNX 1.31.1 的独立锚点来自官方 npm 元数据的 tarball SHA-512，归档通过 SRI 后提取三个资产的 SHA-256；许可证固定摘要。vendored harness 包的版本从不可变 pin tag 读取，锁文件解析必须等于声明地板；每个打包声明中的静态 import/export/import type 必须有 consumer dependency、optionalDependency 或 peer。验证：`vendor-onnxruntime` 篡改反例、`harness-vendor-state`、`published-declarations`、`verify:pack`。
- **scholarly 融合身份语义**：`src/scholarly/fusion.ts` 按 `identityRelationOf` 裁决候选，优先精确匹配正式 DOI，并保留冲突键的多个候选；身份门、强标识集合或仲裁顺序的任何改动必须同步更新 `tests/scholarly/fusion-bridges.spec.ts` 的正反例。验证：`fusion-bridges.spec.ts`、`fusion.spec.ts`、`fusion-identity.spec.ts`。

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

> 说明：插件配置持久化在当前 profile 的 `cordis.patch.yml`（`zotero` 条目）。Zotero 连接等配置首次在临时实例的插件管理器中打开 **dsh-zotero** 配置区填写一次即可（也可从现有 profile 的 `cordis.patch.yml` 拷入 `zotero` 条目的 `config`）。

> 学术组件：随包发布的 `dsh-zotero/scholarly` 行默认关闭，开关只有这一处。两份叠加层模板（`dev.cordis.yml.example` / `dev-lib.cordis.yml.example`）都会挂载学术组件，本地调试无需先在插件管理器里打开该行；在真实 profile 中调试时，在「包含的组件」中启用该行即可，工具与设置页即时生效，无需重启。

### 仅 Host 端调试（支持 HMR）

```sh
npm run build                                    # 首次构建 lib/ 目录
npm run dev &                                    # 监听并自动增量编译至 lib/
cp dev-lib.cordis.yml.example dev-lib.cordis.yml # 复制叠加层模板并配置实际绝对路径
dsh web --patch ./dev-lib.cordis.yml --port 3307
```

> 注意：`dev-lib.cordis.yml` 叠加层通过配置构建入口的绝对路径（`<absolute-path-to-dsh-zotero>/lib/index.js`）加载插件，使得 Host 端（模型工具）能在 Loader 监视下实现免重启热重载；但 Harness 客户端模块加载器仅解析已注册的裸包名，因此该模式不加载浏览器端前端组件（设置页、文献轨迹与文献面板）。如需调试前端 UI，请使用上述「完整插件调试」流程（`dsh plugin --profile web add .` 与 `npm run dev:client`）。

### 诊断面板与诊断包

排查插件运行问题时，可在配置区开启「开启诊断」后，在插件详情页底部的「诊断」卡片中查看运行时状态与日志：

- **日志收集与过滤**：开启诊断后，收集并保留相关条目，支持按级别筛选（「仅问题」筛选 warn 与 error）。条目按时间倒序排列，连续出现的重复记录会自动合并计数；
- **诊断模式**：在 dsh-zotero 配置区的「高级选项 → 诊断」分组中开启「开启诊断」并保存后，详情页底部即展示诊断面板并记录详细排障日志；
- **前端异常捕获**：前端界面（文献轨迹、文献面板、工具卡片等）发生渲染崩溃时，错误边界会自动记录异常信息，并在 `surface` 字段标明触发位置（如 `sources`、`tool:zotero_search`）；
- **导出诊断包**：点击「复制诊断信息」可生成包含插件版本、Zotero 端点与版本、debug 状态及全部缓冲记录的文本包，便于粘贴至问题报告。

## 执行包编号 → 测试 → 验收对照（WP0 基线）

本表是 WP0 第 5 项要求的编号→测试→验收结果对照，按当前工作树记录。「已实现」表示该包的协议/源码与行为测试存在，不含实时或效果验收。结论以本机测试文件与已运行的检查为准；实时/浏览器/模型矩阵检查未运行的项目标记「未验收」。

| 编号 | 主题                                 | 行为测试证据（真实存在的 spec）                                                                                                                                                                                                                                                                                                                                                                                                          | 验收结果                                                                                                                                                                 |
| ---- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WP0  | 冻结产品、协议与复现标准             | `tests/host/enrichment-api-contract.spec.ts`、`tests/unit/enrichment-preferences.spec.ts`、`tests/unit/enrichment-parse-wire.spec.ts`、`tests/host/doc-examples.spec.ts`                                                                                                                                                                                                                                                                 | 已实现（协议闭合、双端类型、组件启用授权文档外发、域名错误保留、旧 parsing 别名清除）；此表即编号→测试→验收记录                                                          |
| WP1  | 普通读取仅复用解析产物               | `tests/local/enrichment-enhancer.spec.ts`、`tests/local/retrieve/retrieve-sources.spec.ts`、`tests/scholarly/enrichment-read-enhancer.spec.ts`                                                                                                                                                                                                                                                                                           | 已实现（只读 `lookup` 接缝、命中优先/正常未命中、启动/打开 PDF/设置保存不触发 MinerU 的负向断言）                                                                        |
| WP2  | 两类主动解析入口与任务生命周期       | `tests/host/enrichment-parse-document.spec.ts`、`tests/host/enrichment-parse-jobs-lifetime.spec.ts`、`tests/host/enrichment-parse-jobs-admission.spec.ts`、`tests/client/enrichment/parse-integration-operations.spec.tsx`                                                                                                                                                                                                               | 已实现（闭合联合目标、会话所属 `ctx.jobs`、取消/卸载清理、Gateway 错误分类）                                                                                             |
| WP3  | 来源身份、解析优先级与 Markdown 结构 | `tests/host/enrichment-artifact-format.spec.ts`、`tests/scholarly/read/read-artifact-format.spec.ts`、`tests/host/enrichment-source-publication.spec.ts`                                                                                                                                                                                                                                                                                 | 已实现（统一身份/源戳、Markdown `format`、outline/section、缓存失效、旧普通文本不遮蔽新产物）                                                                            |
| WP4  | 下载、安装、目录与 CLI               | `tests/host/enrichment/model-cli-coordination.spec.ts`、`tests/host/enrichment/model-installation-safety.spec.ts`、`tests/unit/model-download-client.spec.ts`、`tests/unit/enrichment-safe-directory-preflight.spec.ts`                                                                                                                                                                                                                  | 已实现（真实流/锁/符号链接与取消安全、bundle 唯一校验、CLI 一致）                                                                                                        |
| WP5  | 排序身份、variants 基础与输出解释    | `tests/local/retrieve/evidence-ranker.spec.ts`、`tests/tools/retrieve-render.spec.ts`、`tests/unit/evidence.spec.ts`                                                                                                                                                                                                                                                                                                                     | 已实现（caller index 保全、重复 handle 拒绝、语义去重映射回全部来源、variants 单调并集、空结果仅在显式 `noMatch` 时下结论）                                              |
| WP6  | 可拒绝无关语料的语义准入             | `tests/unit/semantic-admission.spec.ts`、`tests/unit/semantic-ranker.spec.ts`、`scripts/semantic-calibration/self-check.mjs`                                                                                                                                                                                                                                                                                                             | 六档实际向量已归档；20 个改写例（english 为 10 个）recall@4 为 55–95%，移除答案对照命中 0。编码为手工流程，自动测试只离线复算。                                          |
| WP7  | 读取作用域、模型事务切换与排空       | `tests/unit/semantic-loader-lifecycle.spec.ts`、`tests/local/retrieve/retrieve-sources.spec.ts`、`tests/scholarly/fulltext.spec.ts`                                                                                                                                                                                                                                                                                                      | 已实现（前台作用域在来源 I/O 前接纳并 `try/finally` 释放、loader 事务化 resident/pending/retired、失败 B 不丢 A、卸载排空）                                              |
| WP8  | 推理取消、验证和有界向量缓存         | `tests/unit/semantic-session.spec.ts`、`tests/unit/semantic-tensor.spec.ts`、`tests/unit/semantic-vector-cache.spec.ts`                                                                                                                                                                                                                                                                                                                  | 已实现（单 `TokenizedBatch`、signal 贯穿、输出张量校验、所有权转移释放、`lru-cache@11.5.3` 有界跨请求缓存）；六档在真实模型上实测通过（见「语义准入档位」）              |
| WP9  | 端到端模型设置状态机                 | `tests/client/enrichment/enrichment-model-controller.spec.ts`、`tests/client/enrichment/enrichment-model-form.spec.tsx`                                                                                                                                                                                                                                                                                                                  | 已实现（完整 `RemoteResult` 码/详情保留、仅 `gateway/service-unavailable` 判缺席、目标世代绑定、草稿不发 RPC、串行刷新与 signal 清理、zh/en 文案锁步）                   |
| WP10 | 清理文档、旧语义与包契约             | `tests/host/doc-examples.spec.ts`、`tests/unit/tooling/client-graph-authority.spec.ts`                                                                                                                                                                                                                                                                                                                                                   | 已实现（12 对 zh/en 文档、旧语义清除、错误码表、语义准入档位与本对照表）；源码/预构建双安装核对未运行                                                                    |
| WP11 | 分层与真实验收，逐问题闭环           | `npm run test:integration`、`npm run smoke:web-composition`                                                                                                                                                                                                                                                                                                                                                                              | 未验收（整体验收门禁；不替代下列实时检查）                                                                                                                               |
| WP12 | 已解析文档统一管理                   | `tests/host/enrichment-artifact-management.spec.ts`、`tests/host/enrichment-artifact-target.spec.ts`、`tests/unit/enrichment-parsed-manager-wire.spec.ts`、`tests/client/enrichment/parsed-manager-tab.spec.tsx`、`tests/client/library/library-panel-header.spec.tsx`、`tests/host/enrichment-artifact-metadata.spec.ts`、`tests/client/enrichment/parsed-manager-actions.spec.tsx`、`tests/client/library/parsed-badge-probe.spec.tsx` | 已实现（index 与目录合并去重、孤儿/悬空/损坏三态、删除清全部别名与收据、完整 URL 不进 wire、artifact 认址、header 顺序与挂载门控）                                       |
| WP13 | 整篇文档窗口读取                     | `tests/local/retrieve/retrieve-fulltext.spec.ts`、`tests/tools/retrieve-fulltext.spec.ts`、`tests/host/source-ledger-fulltext.spec.ts`                                                                                                                                                                                                                                                                                                   | 已实现（ref 优先复用解析 Markdown，缺失时读取索引文本；artifactId 可读 URL 产物；无解析/下载/上传，UTF-16 窗口无损续读，超内联预算完整文件交付，卡片与轨迹记录全文事实） |

### 未运行的实时验收（需单独用户授权）

以下项目未在本轮运行，标为未验收。执行前须取得用户对被测具体文档的授权；模拟组件测试不替代浏览器验收：

- **MinerU free / pro 实时上传**：分别用内容已知的专用合成 PDF（附件放隔离库/测试条目）测试；无 pro 凭据或实时服务时列为未验收。
- **浏览器端到端验收**：打包到临时 Harness profile，实际操作附件解析、顶层附件、URL 解析、重新解析、取消、重连、组件切换与模型切换，验证按钮权限、进度、错误恢复、窄屏/键盘与旧响应隔离。
- **实时 Zotero 只读链路**：`npm run test:integration` 需本地 Zotero 运行在 `127.0.0.1:23119`，本轮未运行。

### 已运行门禁（真实结果）

- `npm test`：661 个 spec 文件、7129 个测试，659 个文件通过 / 2 个文件跳过（需实时 Zotero 与写入探针，共 27 个测试跳过）/ 0 失败；没有任何测试加载模型或访问网络。
- `npm run release:check`：退出码 0（format、strict harness、lint:test、lint:hooks、style:check、typecheck、coverage、build、verify:pack 全通过；`verify:pack` 核对打包条目）。
- `npm run build:client`、`npx vitest run tests/host/doc-examples.spec.ts`：通过。

### 问题编号 A1–X4 结项对照

| 编号 | 修复位置                                                                                              | 行为测试                                                                                                                                            | 结论                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A1   | `local/fulltext-enhancer.ts` 只读 `lookup` 缝、`enrichment/service.ts` 私有解析域                     | `tests/local/enrichment-enhancer.spec.ts`、`tests/scholarly/enrichment-read-enhancer.spec.ts`、`tests/host/enrichment-parse-jobs-admission.spec.ts` | 普通读取不再 `enhance`/上传；负向断言通过                                    |
| A2   | `enrichment/parse-{target,document,jobs}.ts`、客户端对话框                                            | `tests/host/enrichment-parse-*.spec.ts`、`tests/client/enrichment/parse-integration-*.spec.tsx`                                                     | 子附件/顶层附件/URL 三类主动入口 + 取消/幂等/跨会话隔离通过                  |
| A3   | `scholarly/fulltext/{resolve,store}.ts`、`enrichment/artifact-store.ts`                               | `tests/scholarly/fulltext-cache.spec.ts`、`tests/scholarly/enrichment-read-enhancer.spec.ts`                                                        | 新产物优先、旧缓存按 revision 失效通过                                       |
| A4   | `src/scholarly/tools/read.ts`、`artifact-schema.ts`                                                   | `tests/scholarly/read/read-artifact-format.spec.ts`                                                                                                 | `format:'markdown'\|'text'`、outline/section、偏移回指通过                   |
| S1   | `enrichment/semantic/admission.ts`、`ranker.ts`（删除 `routeBest-0.02`）                              | `tests/unit/semantic-admission.spec.ts`、`tests/unit/semantic-ranker.spec.ts`                                                                       | 固定余弦策略由归档真实向量复算；报告保留 hybrid 旧门槛误命中及修正结果。     |
| S2   | `local/evidence-ranker.ts`（每 phrasing 独立准入并集）                                                | `tests/unit/semantic-ranker.spec.ts`、`tests/local/retrieve/evidence-ranker.spec.ts`                                                                | 新增 variant 不删除原成员通过                                                |
| S3   | `src/evidence.ts`（`indexes` 保全）、`ranker.ts`（去重映射全部来源）                                  | `tests/local/retrieve/evidence-ranker.spec.ts`、`tests/unit/semantic-ranker.spec.ts`                                                                | 非连续/重复文本/重复 handle 测试通过                                         |
| S4   | `enrichment/semantic/loader.ts`（resident/pending/retired 事务）                                      | `tests/unit/semantic-loader-lifecycle.spec.ts`                                                                                                      | 失败 B 不丢 A、A→B→A、排空、单次 release 通过                                |
| S5   | `enrichment/semantic/vector-cache.ts`、`session.ts`                                                   | `tests/unit/semantic-vector-cache.spec.ts`、`tests/unit/semantic-session.spec.ts`                                                                   | 跨请求缓存、单 `TokenizedBatch`、信号贯穿通过                                |
| S6   | `src/tools/retrieve.ts` 渲染、`local/retrieve.ts`                                                     | `tests/tools/retrieve-render.spec.ts`                                                                                                               | 显式 `noMatch` 分类、预算省略不与「无匹配」矛盾通过                          |
| D1   | `enrichment/model-download-client.ts`（响应消费作用域）                                               | `tests/host/enrichment/model-response-scope.spec.ts`                                                                                                | 16 MiB 真实 undici 大正文、redirect/error 体释放通过                         |
| D2   | `enrichment/model-downloader.ts`（同步预占、cancel/dispose 排空）                                     | `tests/host/enrichment/model-task-ownership.spec.ts`                                                                                                | 并发/取消/卸载/已中止 caller 通过                                            |
| D3   | `enrichment/model-bundle-inspector.ts`、`model-downloader.ts` 只读 status/verify                      | `tests/host/enrichment/model-installation-state.spec.ts`                                                                                            | 缺 marker/同尺寸损坏/不同 revision 判 not-ready、状态零写入通过              |
| D4   | `enrichment/model-installation.ts`、`model-download-client.ts`                                        | `tests/host/enrichment/model-installation-safety.spec.ts`、`model-cli-coordination.spec.ts`                                                         | 私有 staging、目录白名单、符号链接哨兵、force 保留用户文件通过               |
| D5   | `enrichment/safe-directory-path.ts`                                                                   | `tests/unit/enrichment-safe-directory-preflight.spec.ts`、`tests/unit/safe-directory.spec.ts`                                                       | 完整候选先检查后创建、ENOENT 与 I/O 区分通过                                 |
| C1   | `client/index.ts`、`enrichment-form-controller.ts`                                                    | `tests/client/enrichment/model-error-codes.spec.ts`、`enrichment-model-controller.spec.ts`                                                          | 完整 `RemoteResult` 码/详情保留、仅 `gateway/service-unavailable` 判缺席通过 |
| C2   | `client/enrichment-form-controller.ts`（`{model,normalizedDir,generation}`）                          | `tests/client/enrichment/model-generation-invalidation.spec.ts`                                                                                     | 晚到结果/草稿/外部更新失效通过                                               |
| C3   | `client/locales.ts`、`docs/configuration.*`、`docs/features.*`                                        | `tests/client/enrichment/*`、文档锁步核对                                                                                                           | 「关闭→BM25；开启但模型未就绪→明确失败」zh/en 一致                           |
| X1   | `enrichment/semantic/{session,tensor}.ts`                                                             | `tests/unit/semantic-session.spec.ts`、`semantic-tensor.spec.ts`                                                                                    | 所有权转移释放、张量 rank/width/finite/维度校验、cosine 不截断通过           |
| X2   | `scripts/fetch-semantic-model.mjs`                                                                    | `tests/host/enrichment/model-cli-installer.spec.ts`、`model-cli-coordination.spec.ts`                                                               | 真实跨进程锁、取消、私有 staging、finally 关闭 dispatcher 通过               |
| X3   | `semantic/model-profiles.ts`, `scripts/semantic-calibration/*`, `tests/fixtures/semantic-admission/*` | 真实向量准入报告与六档原始向量；`semantic-admission-measurement.spec.ts` 逐项复算。                                                                 | 自动测试不加载模型、不联网；历史 logistic 报告由独立元数据守卫检查。         |
| X4   | 全仓清除 `allowParsingUpload` / `dsh-zotero/parsing` / 旧 `{lookup,enhance}` 描述                     | `tests/host/enrichment-parse-aliases.spec.ts`、文档 Grep                                                                                            | 无旧别名/迁移/兼容分支                                                       |

表内「通过」仅指对应行为测试与本机门禁通过；效果、实时与浏览器验收状态见上节。

## 测试规范

- 单元测试运行于模拟 Zotero HTTP 服务（MockZotero）上；
- 浏览器配置页测试基于 JSDOM 与 `@testing-library/react`；
- 覆盖率阈值定义在 `vitest.config.ts` 中，对各核心分层分别设置门禁指标；
- 集成测试针对真实运行的 Zotero 实例验证网络协议与真实数据。

### 客户端测试替身

工具测试通过公开的 `@deepseek-ai/dsh-tool-testkit` 执行真实单调用管线，locale fixture 使用同 pin 的 `@deepseek-ai/dsh-client-test-runtime/src/translate.ts`：这个子路径由包的 `./src/*` 显式导出，且注册表包实际发布 `src`。该纯函数入口移除了本地翻译算法副本。工具包和客户端测试支持均只进入 devDependencies，并由精确 overrides 绑定 harness pin。

完整 Slot runtime 已通过包显式发布的生产源码契约装配，并实际用于 slot 创建/销毁与资源组合测试。测试仅对加载器形式的 `/client` 入口使用该映射，普通 ESM 入口仍读取编译产物；原始资源编译包另有真实执行用例。Vitest 依赖按同一运行实例解析。入口组合测试另以公开 `TestClient` 运行生产 `bootClient`，渲染七个设置页签并验证保存、重载和完整卸载；本地记录替身仅用于故障注入，不能替代装配验收。升级 runtime、浏览器导出或测试运行器时，重跑发布源码映射的正反例、slot 生命周期与编译包执行用例。

## CI 工作流

`.github/workflows/` 下有五个工作流：

- `release-branch.yml`：推送 `v*` 标签后，由只读质量作业生成单一产物，在 Linux、macOS、Windows 的干净 profile 中用 pnpm 11 安装并加载四个宿主入口；Linux 另跑浏览器 Web smoke，失败保留 profile 与安装日志。三个平台全部通过后，`npm-release` 通过 OIDC 向 npm 提交 tarball，`publish` 校验产物并更新预构建的 `release` 分支；
- `prebuilt.yml`：`main` 推送或手动触发时，构建并校验预编译产物、更新 `release` 分支；`v*` 标签推送不触发。它与 `release-branch.yml` 共用 `release-branch` 并发组，两者不会同时移动该分支；
- `verify-npm-release.yml`：发布工作流成功完成后启动，由 `npm-publication` 环境延迟运行。它复用原运行的产物，核验公开 tarball 后创建 GitHub Release；
- `upstream-health.yml`：每周一 02:00 UTC 定时跑 `npm run release:check`，并比对已钉版本与上游 harness 主线；
- `scanner.yml`：在 pull request 与 `main` 推送时运行 HOL Guard 扫描器，规范化分数低于 75 即失败。

供应链约定：

- 所有第三方 GitHub Action 固定到不可变 commit SHA，行尾注释标注对应版本号，避免可变 tag 静默改变执行内容；
- npm 发布走 OIDC 可信发布：由 `id-token: write` 获取短期凭据（npm CLI ≥ 11.5.1、Node ≥ 22.14；本仓库 pin 的 Node 24.15.0 自带 npm 11.12.1），公开仓库与公开包默认生成 provenance；发布仍受 npmjs.com 上可信发布配置的约束；
- `npm run deps:check` 直接查询 registry，比对 `package-lock.json` 中的版本，列出可更新的直接依赖。Node 类型以 `engines.node` 的最低主版本为轨道，Undici 跟随固定版 Harness 代理。轨道外和宿主约束下的更新单列，退出码 1 表示有可更新项，2 表示检查失败；版本更新由人工执行，Dependabot 不开版本更新 PR；
- Dependabot alerts 只用于 CVE 提醒，security updates 关闭；
- 浏览器 bundle 镜像 sibling harness 在 `packages/client/*` 清单里声明的第三方运行时依赖（lexical、katex、react、zod 等），这些版本随 harness 一起升版，`deps:check` 的排除集合已把它们滤掉；
- 扫描器工作流只授予 `contents: read` 且不保留 checkout 凭据，因此 fork 的 pull request 也能在同等约束下运行。

## 发布检查清单

发布前按顺序完成以下检查，任一步失败即停止：

1. `npm run typecheck`：Node、宿主测试、浏览器端、浏览器测试与 CLI 五个工程的类型检查；
2. `npm run build:client`：浏览器端产物可以单独构建；
3. `npm test`：测试规范守卫（lane、`.only`/`.skip`、spec 行数棘轮）与全量 vitest；
4. `npm run format:check`：Prettier 格式检查；
5. `npm run release:check`：发布门禁，依次运行 `format:check`、`harness-state.mjs --strict`、`lint:test`、`lint:hooks`、`tokens:check`、`style:check`、`build`、`typecheck:after-build`、`test:coverage`、`test:calibration` 与 `verify:pack`；可直接从 `npm ci --ignore-scripts` 开始，无需预构建；
6. 打包核对：`verify:pack` 已在第 5 步校验 tarball 的必需文件；如需人工确认可执行 `npm pack --dry-run`，核对产物包含 `lib/`、`cordis.patch.yml`、`locale/`、`README` 与 `docs/plugin-detail.md`；
7. 走查核心流程：G1 至 G8 主流程必跑；改动涉及面板或轨迹时补 P 组用例，涉及写入时在启用写入的独立会话中补 W 组用例；
8. 素材核对：本版本文档不内嵌截图，`docs/images/` 保留插件图标 `icon.png`、画幅组合图与 Web UI 参考截图；若发布说明另行配图，必须从当前 Web UI 截取，并与界面文案一致。

`npm test` 与发布门禁不等价：它执行 `node scripts/test-lint.mjs` 加 `vitest run`（不跑覆盖率门禁），是日常回归命令；发布路径把这两件事分别交给第 3 步与第 5 步。

三平台安装 smoke 将 `tests/fixtures/dsh-cli-consumer/` 的清单和 lockfile 复制到 runner 临时目录，再用 `npm ci` 安装固定版本的 dsh CLI 与 pnpm。矩阵中只有 Linux 浏览器检查需要安装仓库开发依赖。npm 缓存键包含两份 lockfile。CLI 安装步骤输出 npm 分阶段耗时，作业失败时保留计时文件。

### 版本、发行说明与发布动作

版本号以 `package.json` 为准，发布前同步更新 `package-lock.json` 根清单，并准备该版本的变更、验证结果与迁移要求。版本 tag 使用 `v<version>`，指向通过全部门禁的 main 提交；tag、清单版本与发行说明版本必须一致。预发布版本使用 SemVer 写法（如 `1.3.0-alpha.1`），npm 发布时显式选择首个预发布标识作为 dist-tag（此例为 `alpha`；纯数字或 `latest` 标识使用 `next`），GitHub Release 同步标记为 prerelease 且不设为 Latest。正式版本发布到 `latest`。

CI 的 quality gate 生成 `release-artifact-<source SHA>`；安装矩阵的三个平台都消费其中的确切 tarball，由 consumer lockfile 安装发布版精确 pin 的 dsh CLI，保持宿主默认的 pnpm 构建批准策略，并从安装后的 profile 实际 import 四个宿主入口。Linux 继续验证浏览器组合、设置保存与重载。publish 作业下载该产物，验证来源及每个文件后，以 CAS lease 更新项目的 release 分支。该作业只下载、验证并发布既有产物。旧 tag 的来源早于已发布来源时，推送被拒绝。

npm 发布与 GitHub Release 已自动化：推送 `v<version>` tag 时，`npm-release` 作业下载同一份已验证产物，重新校验来源与每个文件，并核对 tag、manifest 与产物内的版本一致。发布前查询 `registry.npmjs.org`。已有版本的名称、版本和 SHA-512 integrity 必须与产物一致。首次查询返回 404 时，作业通过 OIDC 将 `artifact.json` 指定的原 tarball 提交给 npm，符合条件的公开包自动附带 provenance。

`verify-npm-release` 下载公开 tarball 并校验实际字节；校验通过后创建或更新 GitHub Release，正文记录 tag 注释、GitHub 生成的变更说明、源 SHA、artifactDigest 和 tarballSha256。作业使用源提交的脚本核验。版本暂不可见时最多查询 12 次、间隔 10 秒；持续返回 404 时在作业摘要中提示，待 npm 显示 **Published** 后可重新运行。原产物保留 7 天，下载或核验失败后也可重新运行。内容变化需要新版本与重新验证。

启用延迟核验前，在 GitHub 仓库 Settings → Environments 的 `npm-publication` 环境设置 **15 分钟** wait timer，并将核验工作流合入默认分支。GitHub 在等待结束后启动 runner；核验作业最多运行 15 分钟。

可信发布要求 npmjs.com 上为 `Vncntvx/dsh-zotero` 配置可信发布者，workflow 文件名须精确为 `release-branch.yml`（区分大小写，含扩展名），并允许 `npm publish`；配置绑定文件名，重命名会导致发布中断。一次性配置步骤与故障排查见本节。

本地 `npm run release:branch -- --dry-run --source-sha <HEAD SHA>` 可审阅产物；工作树须干净。真实推送要求显式 `--push --artifact <checked artifact directory>`，目标固定为项目 origin 的 release 分支。

发布与 harness 升级的浏览器验收：在完整 `release:check` 之后运行 `npm run smoke:web-composition`，保留临时 profile、浏览器报告和错误日志；保证范围按实际测试的精确 pin 计。

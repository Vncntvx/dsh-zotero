<p align="right"><a href="development-notes.en.md"><b>English</b></a></p>

# 开发留意

## 定位与范围

本文记录未来修改必须持续复核的开发约束，重点包括上游契约绕行、升级触发的迁移事项，以及代码和测试中不易看出的行为边界。每条记录都应说明约束为何存在、何时复核、如何验证，以及条件满足后如何收敛实现。

这里不是待办清单、设计讨论或普通实现说明。只有当遗漏该事项可能导致回归、错误迁移或破坏上游兼容性时才应新增条目；一般性的 TODO 和已在架构文档中完整说明的内容不重复记录。新增或修改条目时同步维护中英文页面。

## 记录要求

- **类型**：上游契约 / 生命周期 / 安全边界 / 兼容性 / 其他开发约束。
- **状态**：生效中 / 待复核 / 已退役。
- **位置**：相关源码、测试或配置路径与符号。
- **要点**：未来修改必须保留的行为、假设或边界。
- **触发条件**：何时必须重新检查该要点，以及检查的命令或证据。
- **验证**：当前实现如何证明要点成立。
- **后续处理**：条件变化后如何迁移、删除或更新实现与测试。

上游契约绕行还必须补充：当前现象、现做法、妥协原因和具体的上游期望。缺少验证方式或后续处理的条目视为不完整。上游 pin 每次升级时，执行“升级复核”流程。

## DN-1：面板解析完成通知的抑制

- **类型**：上游契约。
- **状态**：生效中（2026-11-13，pin `0.2.2-rc.2`）。
- **位置**：`src/enrichment/parse-jobs.ts` 的 `holdNotice`、`PARSE_NOTICE_WAIT_MS`、`PARSE_NOTICE_REARM_MS`。
- **现象**：文献面板解析 PDF 成功后，harness 向所属会话投递“后台任务状态更新”，空闲会话被 `followup` 唤醒成一轮新对话。通知只要求模型读取 job 输出，而解析 job 的输出只是回执（artifactId、字符数、有界 preview），没有正文或可读路径；模型因此翻找主机文件，最后输出一份没人要求的解析报告。
- **现做法**：解析 job 以 `owner` 注册、`toolCall` 留空。宿主在 `registry.start` 返回后立即挂 `ctx.jobs.wait`，并每半个 waiter 生命周期续挂一个后继；等到结算时至少有一个 live waiter，registry 把结算标成 `awaited`，tool-jobs 的完成通知据此跳过。waiter 不消费输出、不取消 job、不删除结算记录。
- **为什么是妥协**：这是用**观察**表达**意图**。`awaited` 的本义是“某个调用方已收到终态投影”，并不等于“这个 job 不需要模型知道”；当前只有 tool-jobs 把 `awaited` 当作“已交付”，所以绕行才成立。未来任何把 `awaited` 解释成“模型已消费”的消费者都会收到假信号。剩余假设是 Node 的到期 timer 顺序与每个回调后的 microtask 排空：后继的到期时刻总早于当前 waiter，即使两者同时过期，后继也会先注册；事件循环若倒挂超过一个等待窗口，进程内其他生命周期同样已失真。稳态是两个 waiter 加一个 interval，结算时全部清除。
- **上游期望**：二选一即可退役本方案。
  1. **声明式**：`JobSpec` 增加 `notify?: false`（或等价的 `modelFacing?: false`），由 registry 带到 `JobSettledData`，tool-jobs 在构造通知前遵守。适用于任何宿主发起的 job。
  2. **按来源推断**：`JobView` 暴露 `toolCall`（durable registration 已有该字段，只差投影），tool-jobs 只通知由工具调用创建的 job。宿主发起的 job 自然静默，但会改变“宿主 job 也想要通知”的语义。
- **复核触发**：每次 `npm run harness:pin -- <ver>` 后，以及 `npm run harness:check` 报出上游产物变化时，执行固定检查：在 `node_modules/@deepseek-ai/dsh-jobs/src/types.ts` 搜索 `notify`、`silent`、`modelFacing`；在 `node_modules/@deepseek-ai/dsh-jobs/src/view.ts` 搜索 `toolCall`；阅读 `dsh-tool-jobs` 的投递条件是否仍只跳过 `awaited` 等运行时状态。任一机制出现即把本条转为“待复核”，并在同一次 pin 升级里完成迁移。
- **迁移**：删除 `holdNotice` 与两个续挂常量；把解析 job 改为使用新的声明（或直接依赖按来源推断）；把 `tests/host/enrichment-parse-jobs-notice.spec.ts` 的 `awaited` 断言替换为新契约（面板解析不产生通知，`run_in_background` 仍产生通知）；同步 `docs/architecture.md`、`docs/architecture.en.md`、`AGENTS.md`；把本条移入已退役。
- **验收**：当前 pin 下，completed、failed、killed、跨等待窗口四个用例都得到 `awaited === true`，删除 `holdNotice` 后这些用例必须失败；迁移后，删除绕行代码仍能保证面板解析不唤醒模型，而模型主动发起的后台 job 仍能收到完成通知。

## DN-2：完整文档读取快照与 Worker

- **类型**：生命周期 / 安全边界。
- **状态**：生效中（2026-11-14，pin `0.2.2-rc.2`）。
- **位置**：`artifact-reads.ts`、`parsed-documents.ts`、`archive-worker.ts`。
- **要点**：读取 lease 绑定真实 peer、会话、原 Agent 与 open 时固定的 store。源换代和目录切换不影响旧快照。browserPeer 可被浏览器连接共享，因此页面关闭由显式 release、一次性期限和资源预算共同兜底，不能只依赖 peer.signal。撤权在每次请求前后复核；无后续请求时由期限回收。候选和已显示版本分别拥有 Blob URL，完整准备成功才换代。
- **Worker**：ZIP 的解包、引用分析与内容列表语义校验在 Worker 中完成；父线程验证闭合消息，持久化只接收归一化负载。取消须等待 Worker 退出再释放并发槽。发布运行使用 `lib/enrichment/zip-worker.js`，由正常 build/prepare 生成。归档准入的并发与队列上限取自配置的 `artifactReader`；`ParseFlight` 必须收到实时的限额策略，用默认策略构造会让这两个配置静默失效。
- **触发条件**：升级 harness 资源、peer 或 invocation 契约，改变快照配置/产物格式，修改 Worker 构建路径。
- **验证**：`enrichment-read-snapshots`、`enrichment-read-lifetime`、`enrichment-archive-worker`、`enrichment-archive-admission`、`parsed-document-*` 测试及 `verify:pack` 的真实 JS Worker smoke。
- **后续处理**：上游提供连接级生命周期或资源刷新 API 后，核实其语义再替换本插件相应管理，保留源绑定、完整发布和资源回收的回归用例。

## DN-3：已解析产物的两次非原子提交

- **类型**：安全边界 / 生命周期。
- **状态**：生效中（2026-11-14，pin `0.2.2-rc.2`）。
- **位置**：`src/enrichment/parse-once.ts` 的 `putNormalized`、`src/enrichment/parse-document.ts` 的 `putSources`、`src/enrichment/artifact-management.ts`、`src/enrichment/artifact-target.ts`。
- **要点**：产物目录（以 `meta.json` 为提交标记）与 `sources/index.json` 是两次独立写入，中间崩溃会留下无 index 的孤儿目录或指向已删目录的悬空索引；一次 URL 解析还会发布最多三个别名键。列表必须按 cacheKey 合并两个视图并去重，删除必须清掉全部别名键、任务文件、该 generation 的解析收据与内存记录，并先失效绑定该产物的读租约。`documentArtifact` 的 `inspect` 只接受具体 target、要求活会话且会对 URL 发 HEAD，不能用于枚举；枚举走 `probe`——一页一次的批量新鲜度探测（有界并发、每批一次索引快照），每 ref 语义与单目标 `inspect` 一致，仍不触碰 MinerU。`meta.json` 的 `sourceUrl` 保留完整 canonical URL（与 index 的 `stamp.url` 一致）用于恢复孤儿 target，但它绝不进入 `identity`、回执、wire 结果或显示字段；列表行只返回 `origin/…`。改动 `artifactMetaSchema`、`parse-once` 提交顺序或产物/索引的发布次序，都必须复核这三条。
- **触发条件**：修改 artifact schema、解析提交流程、source index 结构、删除/列表端点，或升级 harness 的存储与文件锁契约。
- **验证**：`tests/host/enrichment-artifact-management.spec.ts`（三态合并、别名去重、完整清理）、`tests/host/enrichment-artifact-target.spec.ts`（附件/URL/孤儿 target 还原）、`tests/unit/enrichment-parsed-manager-wire.spec.ts`（wire 无完整 URL）、`tests/host/enrichment-parse-document.spec.ts`（identity 脱敏）、`tests/host/enrichment-artifact-metadata.spec.ts`（meta/probe 无租约与批量新鲜度）。
- **后续处理**：若上游或本地实现提供产物目录与索引的原子提交事务，可移除列表的目录枚举合并与 `orphan`/`broken` 状态机，并把删除简化为单事务；届时仍需保留「完整 URL 不进 wire」与「删除后刷新已打开解析页」的回归用例。

## DN-4：产物库存的写代数失效

- **类型**：生命周期 / 性能边界。
- **状态**：生效中（2026-11-14，pin `0.2.2-rc.2`）。
- **位置**：`src/enrichment/artifact-store.ts` 的 `touch`、`inventory`、`groupByArtifact`；`src/enrichment/service.ts` 的 `storeFor`。
- **要点**：store 实例按解析后的根目录记忆化（每个 root 单实例），库存（目录枚举加每个 cacheKey 一次 `metaFor`）按写代数缓存；每次写尝试——包括失败的写——都先 `touch()` 递增代数并失效缓存。新增任何 store 写方法必须同样先 `touch()`，否则库存与分组视图读到陈旧数据。源索引本身按调用读、不缓存：索引 I/O 失败必须浮出，不允许藏在缓存后面。
- **触发条件**：新增或修改 `ParsedArtifactStore` 的写路径，或改变库存/分组的派生来源。
- **验证**：`tests/host/enrichment-artifact-management.spec.ts` 的「serves the inventory from cache until the store is written again」与分组用例；`tests/host/enrichment-artifact-store.spec.ts` 的索引读契约。
- **后续处理**：若上游提供产物存储的变更通知或失效钩子，可把写代数替换为权威失效；保留「写即失效」与「索引失败不缓存」的回归用例。

## DN-5：打包冒烟必须脱离父进程的 npm dry-run 模式

- **类型**：其他开发约束（npm CLI 行为）。
- **状态**：生效中（2026-11-15，npm 12）。
- **位置**：`scripts/smoke-archive-worker.mjs` 的 `smokeArchiveWorker`。
- **要点**：`npm publish --dry-run` 会带着 `npm_config_dry_run=true` 运行 `prepublishOnly`，冒烟里嵌套的 `npm pack` 继承该环境后产出 0 个 tarball，`verify:pack` 因此报「npm pack did not produce exactly one tarball」。冒烟在子进程环境里删掉这一个变量，让嵌套 pack 始终真实落盘；其余 npm 设置照常继承。
- **触发条件**：修改发布门禁的脚本链、升级 npm 主版本，或给该冒烟新增子进程调用时，重跑 `npm publish --dry-run` 复核。
- **验证**：`npm publish --dry-run` 全程通过，日志里同时出现 `archive-worker pack smoke ok` 与 `verify-pack ok`；单独 `npm run release:check` 仍通过。
- **后续处理**：若 npm 不再把 dry-run 传给生命周期子进程，或提供显式关闭方式，可删除这段环境清理，但保留「冒烟必须拿到真实 tarball」的断言。

## DN-7：语义排序运行时打进包内，不做依赖

- **类型**：兼容性 / 安装策略。
- **状态**：生效中（2026-11-15，pnpm 11 `strictDepBuilds`）。
- **位置**：`scripts/vendor-onnxruntime.mjs`、`src/enrichment/semantic/runtime.ts`、`package.json` 的 `files`/`build`/`devDependencies`、`scripts/build-prepare.mjs`、`scripts/verify-pack.mjs`、`scripts/shared/build-approvals.mjs`、`tests/unit/tooling/vendor-onnxruntime.spec.ts`。
- **现象**：语义检索的 WASM 运行时 `onnxruntime-web` 传递依赖 `protobufjs`，后者带一个空操作的 `postinstall`。pnpm 11 默认开启 `strictDepBuilds`，依赖存在未决定的构建脚本时整次安装非零退出（`ERR_PNPM_IGNORED_BUILDS`）；桌面端插件安装随之回滚。1.1.0 首次把它作为运行时依赖发布，于是从 1.1.0 起插件在 pnpm 11 上无法安装。
- **现做法**：运行时**不是依赖**，而是打进包内的构建资产：`scripts/vendor-onnxruntime.mjs` 从开发依赖 `onnxruntime-web@1.31.1` 复制 Node 入口、wasm 胶水与 wasm 二进制（压缩后约 3.8MB）到 `assets/onnxruntime/1.31.1/`，写 `provenance.json`（来源、字节数、SHA-256），并删除其它版本目录；`assets/onnxruntime/LICENSE` 固定携带 MIT 许可。`semantic/runtime.ts` 用绝对 `file://` URL 加载该入口，把 `env.wasm.wasmPaths` 指向同一目录（结尾必须带分隔符，运行时用字符串拼接文件名）。资产与 `lib/` 一样是生成产物（gitignore），`npm run build`、`scripts/build-prepare.mjs` 与 `npm run assets:runtime` 都会重建；`verify:pack` 校验哈希、许可与「三个资产文件确实进包」。`onnxruntime-common` 是唯一的正常依赖（无安装脚本、无自身依赖）。
- **触发条件**：升级 `onnxruntime-web`（必须同步改 `SEMANTIC_RUNTIME_VERSION` 与 `devDependencies` 的精确版本，否则守卫 spec 直接失败）、新增任何运行时依赖、pnpm 主版本升级，或上游改变插件安装/构建批准策略时复核。
- **验证**：`tests/unit/tooling/vendor-onnxruntime.spec.ts`（版本一致、文件清单一致、哈希与许可）、`tests/unit/enrichment-semantic-runtime.spec.ts`（加载路径、wasmPaths、缺文件 fail-closed）、`tests/unit/tooling/build-approvals.spec.ts` 与 `tests/unit/tooling/verify-pack.spec.ts`（闭包无安装脚本、打包路径齐全）。人工复核：用桌面运行时自带 pnpm 11.28.5 把打包产物装进干净 profile，应零批准通过；随后从安装位置 import 打包入口并对空文件调用 `InferenceSession.create`，应返回 wasm 侧的 `No graph was found in the protobuf`，证明 wasm 胶水与二进制确实被加载。
- **后续处理**：若 pnpm 允许依赖自行声明或豁免构建脚本，或 `onnxruntime-web` 放宽 `protobufjs` 到 8.x（8.x 已无 `postinstall`），可把运行时改回 `dependencies` 并删除 vendor 脚本、包内资产与相关守卫；否则每次升级按 `assets:runtime` 重新生成并复核包体体积。

### DN-8：面板自己解析类型名与作者，条目列表保留翻页

- **类型**：数据契约 / 显示语义。
- **状态**：生效中（2026-11-15，pin `0.2.2-rc.2`）。
- **位置**：`src/contract.ts` 的 `ZoteroSearchItemView`、`src/library-views.ts` 的 `searchItemViewOf`、`src/client/library-item-type-locales.ts`、`src/client/components/library/item-type-labels.ts`、`use-item-type-labels.ts`、`LibraryItemList.tsx`、`LibraryInspector.tsx`。
- **要点**：行的作者取 wire 新增的结构化 `authors`，类型名按「插件词典 → Zotero `/itemTypes` 的 `localized` → 原始 `itemType`」三级解析，期刊取 `venue`。`meta.creatorSummary` 仍随 wire 传输，但只在 `authors` 缺失时兜底：它是 Zotero 用自身语言拼好的串（中文环境两个作者之间用连词且两侧不带空格），客户端无法在不破坏姓名的情况下改正，因此显示层不再消费它。item-type 词汇表由面板在三个 pane 之上读一次（`useItemTypeVocabulary`）并共享给筛选菜单、列表行与详情 eyebrow，筛选带自身不再遍历，切换 scope 不会重复请求。条目列表保留「上一页/下一页」：官方客户端一律用 show-more 累积加载，但本插件面向上万条的大库，需要区间跳跃，累积窗口也会让 DOM 变长；这是有意的产品分化（`docs/features.md` 的「文献列表则按页展示」），不是待办。
- **触发条件**：升级 harness（wire 编解码 / `Remote` 契约）、Zotero `/itemTypes` 的 `localized` 改名或消失、出现新的自定义条目类型、或产品决定把条目列表改成累积加载时复核。
- **验证**：`tests/unit/library-views.spec.ts` 断言 `authors`/`venue` 透传且空作者列表不落键；`tests/client/library/remote-contract-library.spec.ts` 断言严格 codec 接受这两个可选字段；`tests/client/library/use-item-type-labels.spec.tsx` 断言分页遍历、失败重试、非前进游标、卸载丢弃与三级解析顺序；`tests/client/library/library-panel.interaction.spec.tsx` 断言选中行的 `aria-current` 与友好类型名、期刊、结构化作者；`tests/client/library/library-tree.spec.tsx` 断言合集条目数角标与「未上报不显示」；`tests/client/library/library-inspector-layout.spec.tsx` 断言摘要窗口只在溢出时出现。
- **后续处理**：若上游直接提供本地化类型名或结构化作者（如 wire 上的 `localizedItemType`），删掉客户端词典与 `/itemTypes` 遍历改为消费 wire；若改用累积加载，按 `LibraryLaneControls.tsx` 的 show-more + 已加载计数范式迁移，并同步 `library-storage.ts` 的窗口状态与 `docs/features`。

## 升级复核

每次 harness pin 变更都从本文开头逐条核对：上游契约是否已经提供期望能力；提供了就必须在同一次改动中完成迁移并退役条目，不允许“能力已到、绕行还在”的状态长期存在。没有提供能力时，只更新 pin 版本号与复核日期，不修改绕行实现。

## 已退役条目

退役条目保留原标题、退役时间与替代机制，便于回溯为什么曾经这样做。

### DN-6：选段解释草稿携带产物 Markdown 的宿主路径

- **类型**：安全边界 / 其他开发约束。
- **状态**：已退役（2026-11-15，本次改动起生效）。
- **位置**：`ParsedDocumentTab.tsx` 的 `explain` 与 `parsedExplainPrompt`、`parsed-tab.ts` 的地址、`tools/retrieve.ts` 的 `mode="fulltext"`、`local/retrieve.ts` 的窗口分支、`enrichment/service.ts` 的 `lookupArtifact`。
- **要点**：原实现把产物 Markdown 的**绝对路径** `<outputDir>/<cacheKey>/full.md` 经 wire 交给浏览器，让解释草稿要求模型先读该文件再解释选段；`zotero_retrieve` 当时只返回排序片段、URL 来源产物也没有条目 ref，路径是唯一能通读整篇论文的定位。现 `zotero_retrieve` 的 `mode="fulltext"` 可按 `source`（附件 ref 或 `artifactId`）分页窗口读取完整文档，且窗口默认尺寸小于内联交付预算（调低 `maxInlineResultBytes`/`maxInlineResultTokens` 时可能落为 file 交付）；解释草稿改为要求模型从 `start=0` 起按 `nextStart` 连续调用该工具直到 `isTruncated` 为 `false`，再解释选段。`documentPath` 已从 wire、metadata 视图与 store 删除，浏览器不再接触宿主路径；整段请求仍是**一张** `insertQuote` 卡片（拆成 `insertText` + `insertQuote` 会在气泡上方留下散落纯文本，实测过的回退），模型侧文案固定英文、两个字典同值，并写明写作规格：用对话语言回答、一句话释义先行、术语首现解释、区分论文主张与自身解读、读取失败时如实说明。整篇读取经 `FulltextEnhancer.lookup` / `lookupArtifact` 只读命中产物，永不触发解析、下载或上传；工具调用由轨迹投影为独立的「全文读取窗口」事实（每条事实是一个窗口，不宣称整篇已读）。长文档的首窗口在宿主提供 spill 存储时会带 `spillRef`，给出整篇有界文本的一次性句柄；窗口链不依赖它也能读完，缺存储时结果不带该字段。每个窗口是一次独立调用：同一文档的 W 个窗口各自做一次源校验与整篇读取（无跨调用缓存，保持无状态与代际安全）；若该成本成为问题，应在增强侧加按代际失效的文档缓存，而不是在 core 里缓存。
- **触发条件**：`zotero_retrieve` 的 fulltext 模式或 `lookupArtifact` 语义变化、宿主 `InputActions` 的 `insertText`/`insertQuote` 语义变化、宿主提供「指令卡片」类容器、或全文窗口改为 file 交付时，重新验证模型确实读到整篇文档、输入框仍只有一个可删除块，且轨迹仍记录该次窗口读取。
- **验证**：`tests/tools/retrieve-fulltext.spec.ts` 断言窗口内联交付与模式互斥；`tests/local/retrieve/retrieve-fulltext.spec.ts` 断言窗口无损拼接、artifactId 寻址、miss/fault 与截断；`tests/host/source-ledger-fulltext.spec.ts` 断言轨迹事实；`tests/client/library/parsed-document-details.spec.tsx` 与 `parsed-document-selection.spec.tsx` 断言草稿含 `mode="fulltext"` 与 `source`、无路径与残留占位、未调用 `insertText`；`tests/host/enrichment-artifact-metadata.spec.ts` 断言 wire 不再含 `full.md`。
- **后续处理**：退役说明——原「若模型获得按 artifactId 读产物的工具则删除 `documentPath`」已由本次改动兑现；若宿主改为不允许模型发起工具调用，需要重审「草稿指示模型调用」这一入口，并同步轨迹可见性验收。

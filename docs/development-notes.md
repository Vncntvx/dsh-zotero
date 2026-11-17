<p align="right"><a href="development-notes.en.md"><b>English</b></a></p>

# 开发留意

<!-- harness-reviewed: 0.2.2-rc.3 -->

当前宿主契约复核：2026-11-17，pin `0.2.2-rc.3`。DN-1 的 waiter 结算语义、DN-2 的读取与 Worker 生命周期、DN-3 的提交和删除互斥、DN-4 的库存写代数，均对照当前实现与对应测试复核。状态行中的较早日期和 pin 记录引入时点。升级时先核实生效条目及验证证据，再更新本条复核记录；pin 写入器不会自动替代复核。

## 定位与范围

本文记录关键开发约束，包括上游契约绕行、升级触发的迁移事项，以及不易直接察觉的行为边界。每条记录说明约束成因、复核时机、验证方式与收敛方案。条目新增与变更需同步维护中英文版本。

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
- **要点**：读取 lease 绑定真实 peer、会话、原 Agent 与 open 时固定的 store。源换代和目录切换不影响旧快照。browserPeer 可被浏览器连接共享，因此页面关闭由显式 release、一次性期限和资源预算共同兜底，不能只依赖 peer.signal。撤权在每次请求前后复核；无后续请求时由期限回收。候选和已显示版本分别拥有 Blob URL，完整准备成功才换代。释放立即删除活跃租约和期限计时器；尚未排空的传输单独保留并发名额。提前取消的请求使用独立、有界、按期删除的准入记录，不占准备名额；释放同时撤销已经等待所有权检查的同 id 请求。
- **Worker**：ZIP 的解包、引用分析与内容列表语义校验在 Worker 中完成；父线程验证闭合消息，持久化只接收归一化负载。取消须等待 Worker 退出再释放并发槽。发布运行使用 `lib/enrichment/zip-worker.js`，由正常 build/prepare 生成。归档准入的并发与队列上限取自配置的 `artifactReader`；`ParseFlight` 必须收到实时的限额策略，用默认策略构造会让这两个配置静默失效。
- **触发条件**：升级 harness 资源、peer 或 invocation 契约，改变快照配置/产物格式，修改 Worker 构建路径。
- **验证**：`enrichment-read-snapshots`、`enrichment-read-lifetime`、`enrichment-archive-worker`、`enrichment-archive-admission`、`parsed-document-*` 测试及 `verify:pack` 的真实 JS Worker smoke。
- **后续处理**：上游提供连接级生命周期或资源刷新 API 后，核实其语义再替换本插件相应管理，保留源绑定、完整发布和资源回收的回归用例。

## DN-3：已解析产物的两次非原子提交

- **类型**：安全边界 / 生命周期。
- **状态**：生效中（2026-11-14，pin `0.2.2-rc.2`）。
- **位置**：`src/enrichment/parse-once.ts` 的 `putNormalized`、`src/enrichment/parse-document.ts` 的 `putSources`、`src/enrichment/artifact-management.ts`、`src/enrichment/artifact-target.ts`。
- **要点**：产物目录（以 `meta.json` 为提交标记）与 `sources/index.json` 是两次独立写入，中间崩溃会留下无 index 的孤儿目录或指向已删目录的悬空索引；一次 URL 解析还会发布最多三个别名键。列表必须按 cacheKey 合并两个视图并去重，删除必须清掉全部别名键、任务文件、该 generation 的解析收据与内存记录，并先失效绑定该产物的读租约。删除会先独占该 generation，中止并等待所有相关解析实际结算，再清理存储；在途 admission 保留撤销标记，即使旧回执读取晚于删除完成也不能重放成功。首个 orphan 尚未创建 `sources/` 时，删除仍须安全建立索引锁目录后完成清理。`documentArtifact` 的 `inspect` 只接受具体 target、要求活会话且会对 URL 发 HEAD，不能用于枚举；枚举走 `probe`——一页一次的批量新鲜度探测（有界并发、每批一次索引快照），每 ref 语义与单目标 `inspect` 一致，仍不触碰 MinerU。`meta.json` 的 `sourceUrl` 保留完整 canonical URL（与 index 的 `stamp.url` 一致）用于恢复孤儿 target，但它绝不进入 `identity`、回执、wire 结果或显示字段；列表行只返回 `origin/…`。改动 `artifactMetaSchema`、`parse-once` 提交顺序或产物/索引的发布次序，都必须复核这三条。
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
- **要点**：`npm publish --dry-run` 会带着 `npm_config_dry_run=true` 运行 `prepublishOnly`。冒烟里嵌套的 `npm pack` 继承该环境后产出 0 个 tarball，`verify:pack` 因此报「npm pack did not produce exactly one tarball」。冒烟从子进程环境中移除该变量，使嵌套 pack 产出一个真实 tarball；其余 npm 设置照常继承。
- **触发条件**：修改发布门禁的脚本链、升级 npm 主版本，或给该冒烟新增子进程调用时，重跑 `npm publish --dry-run` 复核。
- **验证**：`npm publish --dry-run` 全程通过，日志里同时出现 `archive-worker pack smoke ok` 与 `verify-pack ok`；单独 `npm run release:check` 仍通过。
- **后续处理**：若 npm 不再把 dry-run 传给生命周期子进程，或提供显式关闭方式，可删除这段环境清理，并保留「冒烟产出一个真实 tarball」的断言。

## DN-7：语义排序运行时打进包内

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

### DN-9：上游「无会话面板」拒绝只是一句散文，客户端按子串匹配

- **类型**：上游 workaround（缺失错误码）。
- **状态**：生效中（2026-11-15，pin `0.2.2-rc.3`）。
- **位置**：`src/client/components/library/ZoteroLibraryPanel.tsx` 的 `NO_SESSION_SURFACE_REFUSAL` 与 `openFile`；`tests/client/library/library-panel.reader.spec.tsx`。
- **现象**：面板打开本地 PDF 走宿主右侧栏的 `openResource`。当本次会话没有挂载会话面时，上游 `@deepseek-ai/dsh-client-ui-sidebar-right` 的 `src/client/service.ts` 直接 `throw new Error('sidebarRight: no session surface is mounted')`：没有错误码，也没有可判别的错误类型。插件要把这个分支显示成自己的提示（`libraryNoSessionForOpen`），只能匹配这条消息文本。
- **现做法**：子串提成 `NO_SESSION_SURFACE_REFUSAL` 常量，注释写明上游出处；spec 引用同一常量构造拒绝，不再复制第二份散文。其它 `openResource` 失败保持原消息（有独立用例）。匹配用 `includes`，因为上游在该句前还带 `sidebarRight: ` 前缀。
- **触发条件**：每次 `npm run harness:pin` 后在 sibling 源码里复核该字符串：`rg "no session surface is mounted" ../deepseek-harness/packages/client/ui-sidebar-right/src`。
- **验证**：`tests/client/library/library-panel.reader.spec.tsx`（该拒绝翻译成面板提示；外来拒绝保留原消息）。
- **后续处理**：若上游为该分支提供错误码或错误类型，改为按 code 判定并删除子串常量与本条目。

### DN-10：客户端加载器 API 与 `resultText` 镜像停在 pin 语义

- **类型**：版本漂移准备。
- **状态**：生效中（2026-11-15，pin `0.2.2-rc.3`；上游 HEAD 已变，rc.3 未变）。
- **位置**：`scripts/build-client.mjs` 的 `CLIENT_LOADER_API`/`assertLoaderApi` 与 `data-plugin-css` 注入；`src/sources/presenters.ts` 的 `resultTextOf`。
- **现象**：两处镜像都对着 rc.3 的语义写死，而 sibling HEAD 已经改了。
  - 模块加载器：本插件把样式文本注入 `<style data-plugin-css="dsh-zotero">`，并以 `load({ id, factory })` 交接；上游 HEAD 改为 `load({ id, factory, meta: () => ({ stylesheets }) })` 并移除 `data-plugin-css` 处理。该变更不在 rc.3 tag 内。
  - `resultText`：`resultTextOf` 与 rc.3 一致（每个块以 `\n` 连接）。HEAD 改为 `reduce` 拼接（前段已以换行结尾时不再补），并新增可选 `formatImage` 参数。
- **现做法**：`CLIENT_LOADER_API` 是本仓库对「加载器接受哪种交接」的唯一声明，因为浏览器加载器是壳层全局、不是可安装包，没有任何本地类型能回答这个问题。`assertLoaderApi` 在构建时按这个常量检查产物：常量指 `meta-stylesheets` 而产物仍注入旧标签、或产物不再注入而常量仍指旧形式，两种漂移都让构建失败，而不是在运行期静默丢样式或丢 handoff。`resultTextOf` 的 JSDoc 已写明与 HEAD 的两点差异，不再声称「语义完全复制」。
- **触发条件**：每次 `npm run harness:pin` 后复核两处上游实现（`packages/client/tsdown.client.ts` 的模块注册、`packages/client/ui-tool/src/client/tool/models/tool-call-model.ts` 的 `resultText`）。上游提供 `meta.stylesheets` 时，同一次改动里翻转常量、迁移样式注入、并把 `engines.dsh` 下界抬到包含该能力的版本。
- **验证**：`tests/unit/tooling/build-client-bundle.spec.ts` 三个方向（旧形式通过、两种漂移各自失败）；`tests/client/presenters.spec.ts` 覆盖当前 `resultText` 行为；`npm run build:client`、`npm run harness:check`。
- **后续处理**：迁移完成后删除 `data-plugin-css` 分支与 `CLIENT_LOADER_API`，把 `assertLoaderApi` 一起删掉；`resultText` 若上游从 `./client` 导出，改为值导入并删除镜像。

### DN-11：artifactId 读取按产物自身校验，不探测来源

- **类型**：安全/性能边界。
- **状态**：生效中（2026-11-15）。
- **位置**：`src/enrichment/service.ts` 的 `lookupArtifact`/`lookupArtifactFrom`，`src/enrichment/artifact-target.ts` 的 `resolveArtifactTarget`。
- **要点**：`lookupArtifact` 是不透明 artifactId 的唯一入口。它按 `(artifactId, contentFingerprint, parseGeneration, store.writes)` 命中读穿缓存，未命中时只读源索引与 `meta.json` 解析出具体来源。artifactId 指向本地产物，因此 URL 文档完成解析后可在离线时继续读取，本地附件删除也不会使产物失效。条目 ref 的读取（`lookup`）仍保留一次 stat/HEAD，因为该路径读取 Zotero 的索引文本。
- **触发条件**：产物生命周期规则变化（例如产物随来源删除而回收）、或上游要求「按 id 读」也做来源新鲜度校验时复核。
- **验证**：`tests/host/enrichment-service.spec.ts` 断言 artifactId 命中不发 HEAD、未知 id 是 fault、响应里带真实来源事实。
- **后续处理**：若产品改为「来源消失即产物失效」，在 `resolveArtifactTarget` 加一次带预算的探测，并把本条改成可探测策略。

### DN-12：排名 scope 的准入与模型回收时机

- **类型**：资源生命周期。
- **状态**：生效中（2026-11-15）。
- **位置**：`src/enrichment/semantic/loader.ts`、`src/enrichment/service.ts` 的 `armSemanticIdleRecycle`。
- **要点**：`retrieve` 在做任何源 I/O 之前 `ranker.admit()`，`scope` 记录准入时刻的目标与代际；加载在该 scope 上立即开始，而不是等到第一次 `embed()`。因此准入后的模型切换不会把这次读取换到另一份模型上，卸载也不会中断已准入的 scope：`dispose()` 只关闭新准入，已准入的实例在 `release()` 后回收。常驻模型在 `semanticIdleTimeoutMs`（默认十分钟）无请求后释放，下一次排名从磁盘重开；卸载时定时器一并清除。
- **触发条件**：排名接口的准入语义、模型装载事务、或空闲回收配置变化时复核。
- **验证**：`tests/unit/semantic-loader-lifecycle.spec.ts`（A→B 事务、失败保留 A、准入后卸载仍可用、重试与重开、dispose 幂等）、`tests/host/enrichment-semantic-lifecycle.spec.ts`、`tests/unit/enrichment-config.spec.ts`（空闲字段）。
- **后续处理**：若上游提供每次调用绑定模型代际的原语，可删掉本地的 scope 层。

### DN-13：代理路由与地址钉住互斥，且全包只用一份 undici

- **类型**：安全 + 依赖一致性。
- **状态**：生效中（2026-11-15，`dsh-http-proxy` 已发布）。
- **位置**：`src/transport/connections.ts` 的 `egressRouteFor`/`publicFetch`/`createPinnedDispatcher`，四个外部出口（MinerU、学术检索、URL PDF、模型下载）。
- **要点**：`proxyRouteFor(url)` 决定一次请求的路由：proxied 走代理包安装的进程级 dispatcher —— **代理自己做 DNS，因此不钉地址、也永不 close（进程共享）**，但词法公网闸照跑；direct 才解析地址、钉住闭集并每次尝试 close。两者不能同时用：钉住的是本进程解析到的地址，代理会另解析一次，混用等于放弃 check-then-connect。`pinned.dispatcher` 只被 `connections.ts` 里那份 undici 的 `fetch` 接受；用运行时全局 `fetch` 会在 handler 接口处以 `UND_ERR_INVALID_ARG` 拒绝。`dsh-http-proxy` 钉的 undici 版本必须与根依赖一致（否则同一份 dispatcher 跨副本传递），锁文件里两者同版。
- **触发条件**：升级 harness（代理包版本）、更换 undici、或新增外部出口时复核；`npm run deps:check` 与 `tests/unit/tooling/harness-mirrored-deps.spec.ts` 会先报警。
- **验证**：`tests/host/*-proxy*`、`tests/scholarly/network.spec.ts`、`tests/scholarly/transport/fake-ip-policy.spec.ts`（钉住 dispatcher 进 fetch init、假代理与私网拒绝）、`scripts/verify-no-bare-dispatcher` 等价守卫（`node scripts/test-lint.mjs` 的 fetch 归属检查）。
- **后续处理**：若上游把 proxy 与 pinning 合成一条 API，删除本地 `egressRouteFor`。

### DN-14：`scrubbedParentEnv` 会补代理变量

- **类型**：行为变更（复用上游的副作用）。
- **状态**：生效中（2026-11-15）。
- **位置**：`src/environment.ts` 的 `scrubbedEnvironment`，`src/local/terminal.ts`（launcher 子进程）。
- **现象**：本地 scrub 以前只做减法（删凭据形状与 `DSH_*`）。改用 `@deepseek-ai/dsh-subprocess` 的 `scrubbedParentEnv()` 后，它在减法的同时把宿主代理变量补进子进程环境。
- **现做法**：这正是 launcher 想要的行为 —— 子进程要像宿主一样联网，否则代理环境里的终端会丢网；显式传入的环境（测试合成表）仍走同一规则但不补代理，因为那张表是调用方选择的完整环境。
- **触发条件**：升级 harness（`SENSITIVE_ENV_PATTERN`/`scrubbedParentEnv` 语义变化）或 launcher 需要与宿主网络策略分离时复核。
- **验证**：`tests/unit/environment.spec.ts`（WSL 判定、进程环境走上游、显式环境不补代理）、`tests/host/terminal*.spec.ts`。
- **后续处理**：若上游把「补代理」拆成显式开关，按 launcher 需要选择。

## 升级复核

每次 harness pin 变更都从本文开头逐条核对：上游契约是否已经提供期望能力；提供了就必须在同一次改动中完成迁移并退役条目，不允许“能力已到、绕行还在”的状态长期存在。没有提供能力时，只更新 pin 版本号与复核日期，不修改绕行实现。

## DN-15：构建摘要与发布产物身份

- **类型**：安全边界 / 发布约束。
- **状态**：生效中（2026-11-16，pin `0.2.2-rc.3`）。
- **位置**：`scripts/build-state.mjs`、`release-artifact.mjs`、`release-tar.mjs`、`publish-release-branch.mjs`、`release-branch.yml`。
- **要点**：完整 build/prepare 成功后，记录源文件、脚本、配置、lockfile、工具链及全部产物的摘要。质量门禁生成去掉脚本与开发依赖的单一产物；Web smoke 消费其 tarball，发布消费其目录。校验同时绑定源 SHA、文件闭集、每个文件摘要、tarball 摘要及包内实际内容。publish 作业检出时不保留凭据，写 token 仅提供给最终推送步骤。目标限于项目 origin 的 release 分支，并以读取到的旧 ref 作为 CAS lease；来源回退和字节变化都会被拒绝。
- **触发条件**：修改构建输入、产物布局、发布入口、Action、Node 或编译器版本。
- **验证**：`build-state.spec.ts`、`release-artifact.spec.ts`、`release-branch.spec.ts`；`release:check` 与实际 tarball smoke。
- **后续处理**：新增构建输入必须进入摘要；新增发布文件必须进入经过验证的文件集合。升级发布工具后保留篡改、漏件、来源回退与凭据隔离测试。

## DN-16：ZIP 的实际解压预算与完整性证明

- **类型**：安全边界 / 生命周期。
- **状态**：生效中（2026-11-16，pin `0.2.2-rc.3`）。
- **位置**：`src/enrichment/zip-reader.ts`、`zip.ts`、`archive-worker.ts`。
- **要点**：先验证目录、local header、数据描述符与条目范围一致，再只解压被选择的文本和引用图片。deflate 的原生 `maxOutputLength` 限制实际输出，输出长度、消耗的压缩长度与 CRC 必须全部匹配；originalSize 仅作元数据，实际输出上限控制内存使用。Worker 设置堆/栈限制及 30 秒截止，取消后等待退出再释放槽位。
- **触发条件**：升级 Node/zlib、改变 ZIP 格式支持、归档预算或 Worker 准入策略。
- **验证**：`enrichment-zip-integrity`、`enrichment-zip-safety`、`enrichment-archive-worker` 及打包后的真实 JS Worker smoke。
- **后续处理**：新压缩格式需提供同等的实际输出硬上限与完整性证明；保留伪造大小、CRC、目录不一致和取消退出测试。

## DN-17：样式 token 的 pin 来源

- **类型**：上游契约 / 构建约束。
- **状态**：生效中（2026-11-16，pin `0.2.2-rc.3`）。
- **位置**：`scripts/style-tokens.mjs` 的 `installedThemeSheets`、`RUNTIME_SEAMS`、`verifyRuntimeSeams`。
- **要点**：CI 使用 lockfile 安装的精确版本 theme 源码核对 dsw/ds；链接开发使用 sibling 的 pin tag。dsh 运行时 seam 逐个对应当前 pin 的设置、CSS 定义或 setProperty 调用；来源表与快照保持闭合一致。
- **触发条件**：每次 harness pin 升级、增加 token 或移动上游定义。
- **验证**：`tokens:check` 已纳入 `release:check`，`style-tokens.spec.ts` 验证漏 token、错误版本和失效来源均被拒绝。
- **后续处理**：上游提供完整 token 清单后，以其公开契约替换来源表，保留精确 pin 与删除检查。

## DN-18：解析页远端图片不自动取回

- **类型**：安全边界 / 性能预算。
- **状态**：生效中（2026-11-16）。
- **位置**：`src/client/remote-image-links.ts`、`parsed-markdown.ts`、`scripts/client-graph-authority.mjs`、`build-client.mjs`。
- **要点**：文档显示前以 GFM/math 语法树把直接和引用形式的 HTTP(S) 图片转换为普通链接，原始文档保持完整；只有产物携带的本地图片经受控 Blob URL 显示。代码块中的示例不能误改。纯解析器依赖闭包已明确列入浏览器 allowlist；加入约 88 KB 后实测整体 750 KB，构建上限为 800 KiB。上游 renderer 当前先接受远端图片，再调用 pathImages，因此 pathImages 不能承担拒绝策略。
- **触发条件**：升级 primitives 的 Markdown 语法或 imageSource、增加 Markdown 扩展、改变图片生命周期。
- **验证**：`parsed-markdown.spec.ts`、`parsed-document-images.spec.tsx` 验证远端/loopback/引用图片无 img 元素，本地图像与代码完整；build 验证闭包与体积。
- **后续处理**：上游提供覆盖远端目标的图片策略 API 后迁移，移除本地重复解析与对应依赖闭包，并据实降低体积预算。

## DN-19：一次性授权、完整写周期与回执

- **类型**：Zotero 协议 / 并发与安全约束。
- **状态**：生效中（2026-11-16）。
- **位置**：`write-auth.ts`、`write-authorization-budget.ts`、`write-operation.ts`、`local/write-keyed-batch.ts`、`local/write-trash-graph.ts`、`write-plan.ts`、`local/write-content-proof.ts`。
- **要点**：Zotero 在鉴权时消耗一次性密钥；授权到发送完成期间必须独占，不能把同一密钥交给两个等待者。整次读改写周期和授权预算由服务持有，跨传输重建保留；审批后的 15 分钟总时限包含排队与授权，超时不能覆盖已发送请求的未知提交状态。原生 POST 支持已有对象的 key/version 和 PATCH 合并语义，最多 50 项，各对象独立提交；按依赖层写完子对象后才能写父对象。每项回执须证明索引、身份、版本和全部提交字段，缺失或矛盾返回 `committed-unverified`，不允许重发。笔记比较 HTML 结构，仅接受已核实的 Zotero 外层包装、控制字符清理和 HTML 解析等价形式；标签与集合按集合比较，个人库关系 URI 统一为本地身份。保存的检索在 PATCH 后重新读取并验证名称、全部条件和版本。撤权使用 credentials 原子修改清除密钥；401 恢复期撤权存储失败时保留 `ZOTERO_WRITE_UNAUTHORIZED`，cause 同时保留原始拒绝和存储失败，停止重新授权和写入。审批文档保留完整值并隔离其 Markdown 语法。计划卡的自由文本意见始终拒绝当前写入，以 `declined.feedback` 原样传回模型、显示正文与投影；即使同一答复还选择 Apply，也不能批准。集合创建、笔记更新及合集归属更新先通过只读 `preflightWrite` 排除已知无效目标；审批之后仍重新检查，不复用审批前快照来写入。 集合与保存检索的 PATCH/DELETE 共用 `local/write-record.ts`，统一鉴权、版本前置条件、404 拒绝与未知提交回执；各域保留自己的字段处理和保存状态核验。
- **触发条件**：升级 Zotero Local API 的写入协议、授权消费或限流语义，改变 credentials 原子接口，调整批量图排序或审批渲染器。
- **验证**：`batch-one-time-grant`、`trash`、`restore-items`、`write-operation`、`write-authorization-budget`、`write-auth`、`plan-literal-values`；协议依据为已安装 Zotero 的 `server_localAPI.js` 中 `writeMultipleObjects`、鉴权与 authorize 实现。
- **后续处理**：升级时重新核验对象级事务与单次密钥消费时机；保留部分冲突、丢失回执、排队取消、总时限和跨重建串行的回归。

## DN-20：共享模型校验与推理准入

- **类型**：本地文件完整性 / 资源所有权约束。
- **状态**：有效（2026-11-16）。
- **位置**：`enrichment/model-bundle-inspector.ts`、`regular-file.ts`、`semantic/bundle.ts`、`tokenizer.ts`、`batching.ts`、`session.ts`、`vector-cache.ts`、`evidence-query.ts`。
- **行为**：安装、状态与加载共用严格目录校验。manifest 在分配前限制为 64 KiB；钉住的文件及其父目录拒绝符号链接。运行时读取器核验 ONNX 与 JSON 解析器实际消费的字节快照，分配和读取受钉住的大小约束。进程校验缓存最多保留 16 个身份，组件卸载时清空。查询和改写在读取源前限制为 2,000 字符；嵌入文本连同前缀在编码前限制为 131,072 字符。每代向量缓存最多一个推理 batch 在途。包含 padding 的批次以 32,768 token 拆分，保留全部行且每条只编码一次。缓存身份覆盖完整模型契约，包括档位与 token 窗口。
- **复核触发**：目录窗口或维度、tokenizer 分配、运行时字节缓冲区所有权、推理并发或文件校验变化。
- **验证**：`semantic-bundle`、`semantic-open-ownership`、`semantic-admission-budget`、`semantic-vector-cache`、`evidence-query-admission`。测试使用真实微型文件和受控会话输出，仓库测试不加载模型。
- **后续**：运行时升级保留精确字节加载与有界准入；调整限制前人工测量真实模型内存和召回。

## DN-21：完整结果交付与有界保留

- **类型**：结果完整性 / 生命周期与资源约束。
- **状态**：有效（2026-11-16）。
- **位置**：`result-delivery.ts`、`result-receipt.ts`、`job-runner.ts`、`write-bounds.ts`、`scholarly/fulltext/store.ts`。
- **行为**：超预算结果必须完整存入附件并返回有界收据；存储失败明确失败，后台任务不得改为完整正文或截断正文。前台提升竞态只发布一次附件，未提升候选不把正文复制到 job outcome。收据按发布时间保留每会话最近 128 次、全局最近 1,024 次交付，call/job 双键共同淘汰；宿主附件由宿主保留，删除收据不删除会话历史引用的文件。坏收据逐条备份隔离。卸载关闭新准入，最多等待 5 秒；已进入发布的工作保留域句柄直到结算再关闭，迟到的未发布 producer 明确失败。浏览卡片保留最多 20 行完整前缀，并在 6 KiB 行预算内计入 JSON 分隔符；保留真实分页及返回计数，以 `omitted` 明示未展示行，规范结果不变。所有写入在计划前和服务批准前检查标量，HTTP 编码前限制为 1 MiB；正文不截断。学术全文的内存和磁盘缓存均在七天后过期，写入时回收旧记录以保持 256 条、128 MiB 上界。
- **复核触发**：宿主附件回收或域关闭契约变化、job outcome 交付变化、写入上限或缓存生命周期变化。
- **验证**：`result-persistence`、`result-retention`、`result-unmount`、`result-jobs`、`export-delivery`、`write-bounds`、`fulltext-cache`。
- **后续**：宿主具备引用计数回收时重新核验附件归属；保持失败、超时、重启排序和晚结算回归。

## DN-22：披露确认绑定组件挂载周期

- **类型**：组件授权 / 上游生命周期约束。
- **状态**：有效（2026-11-16，pin `0.2.2-rc.3`）。
- **位置**：`component-enablement.ts`、`remote.ts`、`client/enable-notice.ts`、`client/status-probe.ts`。
- **行为**：每次 scholarly/enrichment 服务构造时生成随机 UUID，以 Cordis `ctx.root` 隔离宿主根上下文。状态端点只公开当前有效挂载的标识；旧挂载的清理不能撤销后继挂载。浏览器保存该标识作为确认值，因此离线期间的重新启用、宿主重启与切换宿主都重新披露。只有明确确认按钮记录接受；Escape 和遮罩点击保持披露。每个已服务周期只读取一次标识，读取失败时仍披露，确认仅保存在当前浏览器会话。状态探测有 30 秒截止时间，销毁会取消请求并阻止迟到结果。
- **复查触发器**：Cordis 根上下文身份、组件重挂载、状态端点、插件管理器状态或披露文字变更；尤其复查上游标为 experimental 的 `ctx.root`。
- **验证**：`component-enablement`、`enable-notice-epochs`、`enable-notice-storage`、`enable-notice`、`status-probe` 与客户端 `apply` 测试覆盖宿主隔离、离线重新启用、旧清理、存储失败、过期异步响应和明确确认。
- **后续动作**：上游若提供稳定的组件挂载标识，迁移到该接口并移除此 WeakMap；保留跨宿主、离线重新启用与清理竞争回归。

## DN-23：解析产物的私有根与内容摘要

- **类型**：证据完整性 / 本机文件系统边界。
- **状态**：有效（2026-11-16）。
- **位置**：`enrichment/safe-directory-path.ts`、`output-dir.ts`、`artifact-schema.ts`、`artifact-store.ts`。
- **行为**：POSIX 产物根必须归当前用户所有且组与其他用户不可写；共享临时根不能直接承载产物，允许其下当前用户的私有子目录。祖先须归当前用户或 root，或具有 sticky 保护，且任何可被其他用户写入的祖先必须有 sticky 保护；新建目录使用 0700。Windows 不以 POSIX uid/mode 判定 ACL。提交元数据记录 Markdown、可选内容列表及全部图像的 SHA-256；每次读取验证摘要与原有字节/字符边界。私有根防止另一账号同时伪造索引、元数据和正文；摘要检出已提交文件的等长替换。缺少摘要的旧产物显式无效，不迁移或悄悄重建。
- **复查触发器**：目录准入、OS 权限、缓存格式、文件读写及图像元数据变化。
- **验证**：`enrichment-output-dir`、`enrichment-artifact-format`、`enrichment-artifact-store` 覆盖共享根、外来所有者、不安全祖先、sticky 临时父目录以及等长文本/图像篡改。
- **后续动作**：保留所有者校验与内容摘要双重证明；Windows ACL 的原生准入需要平台验证，不能从 POSIX 测试推导。

## DN-24：上游镜像、静态清单与搜索折叠复验

- **类型**：上游契约 / 升级复验。
- **状态**：有效（2026-11-16，Harness pin `0.2.2-rc.3`；Zotero 10.0.2-beta.9 源契约，现已复核 11.0-beta.4+045d52044）。
- **位置**：`fiber-state.ts`、`service.ts` 的 `LOGGER_LEVEL` 与动态写工具注册、`typert.ts`、`wire-schemas.ts`、`search-text.ts`、`scripts/verify-zotero-search.mjs`。
- **行为**：Cordis const enum 没有可导入的运行时对象，FiberState 与 LoggerLevel 采用类型锚定的数值镜像，新增状态由穷举表阻止静默遗漏。独立仓库无法使用要求 monorepo 布局的 Typert 生成器，改由同一严格 descriptor 表派生宿主成员和浏览器命名空间，清单只注册一次。写工具随配置动态注册，因为面板通过不带 toolSet 的 `tools.execute` 执行，`when` 不能代替注册生命周期。搜索折叠镜像必须与实际 Zotero 的 `chrome/content/zotero/xpcom/utilities_internal.js` 中映射表、格式标签表达式和 `normalizeForSearch` 三者一起比较。环境清洗复用见 DN-14；对象图与非原子批写见 DN-19；外部资源属主边界见 DN-11。
- **复查触发器**：任何 Harness pin、Cordis 状态/日志枚举、工具执行语义、Typert 生成器布局、Zotero 升级或 `search-text.ts` 修改。
- **验证**：`npm run typecheck`、`typert-parity`、客户端 Remote 契约与写入策略测试。Zotero 每次升级后执行 `node scripts/verify-zotero-search.mjs --archive /Applications/Zotero.app/Contents/Resources/app/omni.ja --report /tmp/zotero-search-equivalence.json`；其他平台可用 `--source <解压后的 utilities_internal.js>`。脚本抽取实际源定义，比较所有 Unicode 标量、固定样本和确定性组合语料，记录源与镜像摘要。本次 1,132,075 例全部一致，无网络请求。
- **后续动作**：枚举出现运行时导出即删除镜像；生成器支持独立仓库则迁移并删除静态装配；面板执行获得 toolSet 时重评动态注册。搜索等值比较一旦失败，先核对实际源版本，再同步镜像和独立回归样本并重跑；禁止以镜像生成预期值。

## DN-25：全文索引清单与库事务游标相互独立

- **类型**：Zotero 协议 / 完整性约束。
- **状态**：有效（2026-11-16）。
- **位置**：`local/changes-domain.ts`、`changes-contract.ts`、`docs/tools.md`。
- **行为**：本机 `server_localAPI.js` 的 FullText GET 强制要求 `since`，SQL 按 `FI.version` 过滤。库事务号不能传作该计数器。显式 fulltext 请求固定 `since=0` 读取完整索引清单，返回索引版本且不发出库增量游标。回收站降级推导只有两侧清单都完整才能给出回收站条目，残缺输入不会被当作删除证明。
- **复查触发器**：Zotero FullText SQL、游标类型、回收站降级路径变化。
- **验证**：`changes` 测试检查 since=0、独立版本与残缺派生；本机只读 GET 返回 579 条合法记录。协议源位于 Zotero app/omni.ja 的 `chrome/content/zotero/xpcom/server/server_localAPI.js`。
- **后续动作**：上游若统一计数器或提供独立全文游标，按已核实协议新增游标；保留不跨计数器比较和完整性回归。

## DN-26：轨迹持久状态只保存参与折叠的事实

- **导出定位约束**：域、显示投影与轨迹统一使用同一个 `ZoteroExportItem` 类型，文本起止位置成对出现或同时缺失；wire 拒绝缺半、负数、非整数、空区间与倒置区间，重放解码丢弃非法定位行。投影不会输出半对。`source-export-locations`、工具输出 schema 和客户端选择器共同覆盖该边界。
- **类型**：持久格式 / 投影生命周期。
- **状态**：有效（2026-11-16）。
- **位置**：`session-projection/source-ledger.ts`、`sources/event-ledger.ts`、`sources/model.ts`。
- **行为**：投影状态版本为 3，只含分块 ledger；删除无人消费的 inheritedEventCount。严格 schema 拒绝旧版本多余字段，宿主从会话事件重放构建当前状态。继承事件仍与普通事件同样折叠。检索工具禁止 includeTrashed，因此轨迹 occurrence 不再声明这项不存在的能力。生产读取只走增量 SourceWorkspaceIndex；测试通过实际投影读取，避免保留第二条全量重放实现。
- **复查触发器**：任何持久状态字段、严格 schema、事件保留或投影版本变更。
- **验证**：`source-ledger-projection`、`source-projection-incremental`、`source-ledger` 与 `source-page` 覆盖重放、继承事件、稳定快照和完整续页。
- **后续动作**：每次格式变化同步提升 stateVersion 并验证宿主从事件重放；新增字段必须有实际读取者。

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

## DN-27：工具参数名在执行前封闭

- **类型**：宿主契约 / 参数完整性。
- **位置**：`define-tool.ts`、`parameter-correction.ts`、全部本地与 scholarly 工具定义。
- **行为**：rc.3 的参数 DSL 生成开放根对象。统一构造器将公开 schema 标为 `additionalProperties: false`，发现未知根参数时调用宿主 `validateJsonSchemaValue` 并抛出宿主 `ToolArgsError`，在任何工具执行之前拒绝；已声明参数继续由宿主 `defineTool` 验证，不重写字段验证。唯一近似匹配同时覆盖缺失的必填参数与可选参数，不猜测歧义名称。动态后台参数只在实际注册时可用。
- **复核触发**：升级宿主工具 DSL、执行管线或参数错误类型，增加工具或动态参数。
- **验证**：`tool-parameter-closure` 检查全部 30 个真实注册及零副作用拒绝；`parameter-correction` 验证实际管线提示；工具与 scholarly 全部行为测试覆盖正常执行。
- **后续**：宿主公开封闭参数根的 DSL 后直接使用该能力，删除本地根参数拒绝分支，保留真实调用与未知可选参数回归。

## DN-28：测试 helper 棘轮绑定当前行数

- **类型**：测试基础设施 / 回归门禁。
- **位置**：`scripts/test-lint.mjs`、`scripts/test-lint.d.mts`、`tests/README.md`。
- **行为**：既有 helper 的基线必须等于当前实测行数；缩小文件而不降低基线也会失败，不能先缩小再在旧额度内长回去。文件删除须移除条目，新 helper 不得加入既有基线。
- **复核触发**：拆分或缩小既有 helper、改动行数度量或门禁基线。
- **验证**：`tests/unit/tooling/test-lint.spec.ts` 覆盖未降低基线、同步降低后通过、再增长被拒及陈旧路径。
- **后续**：继续随拆分降低基线；保留独立用例验证门禁本身。

## DN-29：公开测试支持与注册表入口差异

- **类型**：上游装配约束 / 依赖 pin。
- **位置**：`tests/helpers/lanes/host-lane.ts`、`tests/client/helpers/mock-translate.ts`、`scripts/test-lint.mjs`、`scripts/harness-state.mjs`。
- **行为**：host lane 使用公开 `executeModelToolFixture`，保留真实管线、call id、agent 与 signal。翻译 fixture 使用注册表包显式导出并实际发布的 `dsh-client-test-runtime/src/translate.ts`，不复制算法。该翻译入口与 whole-client tier 的三个独立装配入口列入测试支持源码门禁的精确清单；它们均由包显式发布，并核实 exports、files 和磁盘路径。rc.3 的完整 runtime 根入口依赖加载器形式的 `/client` 产物。`client-test-platform.mjs` 只将这类入口按包声明的类型路径映射到显式发布的生产源码，缺少源码契约或文件即失败；Vitest 单实例解析避免包内 Vitest 4 与仓库 Vitest 5 分裂。`slot-runtime`、共享菜单和解析文档测试实际创建、使用和销毁公开 `SlotTestRuntime`。入口组合测试通过公开 `TestClient` 运行生产 `bootClient`、Cordis、网关和 SlotRegistry，渲染七个设置页签，验证保存、热重载、命名空间与 slot 卸载；本地故障注入替身的记录不作为装配成功证据。独立资源用例按物理路径执行原始编译包，保持发布产物覆盖。pin 脚本从直接声明及当前 lock 闭包补齐精确 harness overrides，再用 npm 重新生成 lock。
- **复核触发**：升级测试支持包、客户端模块载入器、测试运行器或 pin 写入逻辑。
- **验证**：host/tool 全套真实调用；`harness-state` 验证新增直接与传递依赖进入同一 pin；`test-lint` 验证纯入口确实发布且其他源码路径仍被拒绝；locale、客户端 DOM 与全部发布检查。
- **后续**：上游将相关 `/client` 入口公开为可直接执行的 ESM 后，删除发布源码映射和对应入口例外；保留真实装配、载荷校验与统一 dispose 验收，本地替身仅承担明确的故障注入。

## DN-30：客户端平台清单与 UI 验收跟随 pin

- **类型**：宿主浏览器模块契约 / 版本复核。
- **位置**：`client-graph-authority.mjs`、`build-client.mjs`、`harness-state.mjs`、`shared/harness-doc-pin.mjs`、`smoke-parsed-ui.mjs`。
- **行为**：浏览器 external 清单只有一个来源； sibling 在场时，门禁以 TypeScript AST 读取 pin tag 的真实 `PLATFORM_MODULES`，逐项拒绝宿主未提供的 external，注释、字符串与动态展开不能充当证明。无 sibling 的注册表检查仍由固定输入的门禁测试覆盖，不能声称本机读取了上游平台表。手动 Chromium 验收复用 `pinnedHarness` / `pinThemeSheets`，不自带版本号；本次按 rc.3 主题运行了两种尺寸、明暗主题和三种生产组件的 12 组布局。生产 `ParseDocumentDialog` fixture 必须传入合并后的宿主翻译函数，不能沿用已删除的 locale fallback；任何组件装配失败均记录 DOM、浏览器错误与截图。pin 写入同步更新 README 徽章、安装要求和技能命令，检查模式拒绝旧版本示例；带日期的历史约束保留原始核验版本。
- **复核触发**：修改宿主平台表、依赖 pin、外部模块或 UI 验收 fixture。
- **验证**：`client-graph-authority` 逐个移除 external 的变异测试；`harness-doc-pin` 的旧标记、缺标记与幂等测试；`harness:check` 对真实 tag 核对；`smoke-parsed-ui.mjs` 运行报告记录布局、控制台错误和替换行为。
- **后续**：升级时重新运行平台表核对、token 快照与 Chromium 验收；保持失败截图和运行时错误可见，不用旧主题或静默 mock 代替验收。

## DN-31：模型运行时的硬截止由 worker 退出证明

- **类型**：本地推理 / 生命周期与资源所有权。
- **位置**：`enrichment/semantic/loader.ts`、`worker-embedder.ts`、`model-worker.ts`、`worker-runtime.ts`、`session.ts`。
- **行为**：每个实际模型实例的 bundle 校验、tokenizer 与 ONNX session 都归独立线程所有。打开 180 秒、单次推理请求 120 秒硬截止到期后终止线程；打开失败只在确认线程退出后拒绝 load，使串行模型切换继续。保留调用方原始取消原因，迟到回复仍被消费清理；最后一个 scope 离开会中止无人持有的打开，排队但已放弃的目标不会再打开。worker 返回的向量逐批核对个数、Float32 类型、维度与有限值；终止的 resident 显式不可用，下一个 scope 新开实例，旧 scope 不能改借新模型。
- **复核触发**：升级 ONNX/WASM、Node Worker、加载/推理截止、模型切换或向量缓存租约。
- **验证**：`semantic-worker-lifecycle` 使用真实线程运行无法合作的循环和消息通道，不加载模型、不访问网络，验证真实退出、队列恢复、取消与迟到回复、非法向量和重新打开；既有 loader/ownership 测试保留固定实例租约。pack smoke 从真实 npm tarball 执行 emitted worker，验证缺失 bundle 在运行时加载前被拒绝。
- **后续**：若 ONNX 提供可证实的硬取消与完整资源释放，可评估减少隔离层；不得用只 race 掉等待但保留卡住 runtime 的实现替换线程终止。真实模型速度和质量测量仍是独立手动验收，线程协议测试不构成模型效果证据。

## DN-32：解析失败回执与续挂任务的恢复边界

- **类型**：脱敏 / 持久化任务恢复。
- **位置**：`enrichment/parse-target.ts`、`transport.ts`、`parse-once.ts`、`artifact-store.ts`、`parse-jobs.ts`、`service.ts`。
- **存储**：会话操作回执与 generation 指针位于独立的 `$DSH_HOME/zotero-receipts/parse-jobs/`，不随产物 `outputDir` 变化。`enrichment-receipt-location` 用真实磁盘验证修改目录并重建服务后仍能查询原回执；跨配置重新启动同一 operationId 继续拒绝。
- **行为**：先对完整错误消息去除 URL、路径和凭据，再限制为 256 字符；超长消息保留诊断开头与处理指引结尾。上传前、上传后的任务均在 24 小时后过期；用户显式解析时删除旧任务并重新提交。轮询次数耗尽会删除续挂记录。损坏 JSON 或不满足 task schema 的记录先删除再视为无任务，读取或删除的权限、I/O 错误仍明确失败。重启后的幂等重放返回 `joined` 或 `completed`，不会凭空宣称启动了作业。
- **复核触发**：修改错误格式、任务持久化、MinerU 任务保留期、轮询预算或重放协议。
- **验证**：`enrichment-parse-failure-receipt` 检查 POSIX、Windows 与 UNC 路径、持久化内容及长 fake-IP 指引；`enrichment-task-recovery` 覆盖过期上传、轮询耗尽后的再次提交、损坏记录与删除权限失败；persistence spec 检查重启重放不创建作业。
- **后续**：MinerU 保留期或协议变化时复核 24 小时上限；保留显式提交边界，普通读取不能以任务恢复为由发起上传。

## DN-33：准入策略的证据与测量范围

- **类型**：模型质量 / 研究证据来源。
- **位置**：`semantic/model-profiles.ts`、`scripts/semantic-calibration/*admission*`、`tests/fixtures/semantic-admission/`。
- **行为**：六档模型在 2026-11-17 经生产 worker 实际编码，原始向量、完整模型 identity、输入摘要、运行环境与逐例测量一并归档。当前策略由自动测试从向量复算；自动测试本身不运行模型。数据是 24 个手工回归例，含 20 个改写与 4 个控制例，english 分别为 12 与 10；BM25 的改写与全例分母必须分开。margin 是固定策略值，不宣称独立拟合。hybrid 旧 floor 0.461 的两次无关命中可用同一组向量复现，修正为 0.509118 后本组召回保持不变、移除答案对照命中为零。
- **复核触发**：模型 revision、tokenizer/prefix、池化、运行时、数据文本、floor 或 margin 变化。
- **验证**：`semantic-admission-measurement.spec.ts` 逐档核对文件摘要并复算余弦、排名、指标与策略；变异输入检查 stale digest、重复 key、维度错误与 synthetic 标记。历史 logistic runtime-report 只作为独立诊断元数据，不承担当前策略的证明。
- **后续**：复测使用 prepare-admission → encode-admission → measure-admission；审阅候选与支持范围后更新策略和全部归档。此小型同组回归不构成真实提取、外部独立标注、heldout 或生产误命中率保证；不得据此扩大产品效果声称。

## DN-34：React Hook 门禁与脚本类型检查

- **类型**：开发约束 / 回归边界。
- **位置**：`eslint.config.mjs`、`tsconfig.scripts.json`、`scripts/harness-state.mjs`。
- **行为**：客户端源码和浏览器测试执行 `rules-of-hooks` 与 `exhaustive-deps`；任何告警使 `lint:hooks` 失败，发布门禁必须调用它。Babel 解析 TypeScript 和 JSX，不依赖 TypeScript 7 已移除的 Compiler API；`.ts` 保持无 JSX 的解析语义。能力判断放在组件边界，不能按可选 hook 的存在切换同一组件的调用序列。需要固定到会话或连接的可变源以该作用域持有，内容更新保留源身份。
- **脚本**：模型下载 CLI 的实现接受 `checkJs`，宿主依赖扫描读取源码语法树并覆盖 `src/`、`tests/`、`scripts/` 的 JS/TS 模块变体；注释和字符串示例不会成为依赖。
- **触发条件**：升级 React、ESLint、Babel 或 TypeScript，增加脚本宿主 API 调用，修改能力门与持久化时序。
- **验证**：`tests/unit/tooling/react-hooks.spec.ts`、`harness-artifacts.spec.ts`、客户端测试、`npm run lint:hooks`、`npm run typecheck`。
- **后续处理**：新增独立 CLI 的宿主 API 调用时将其实现加入脚本类型检查；升级解析器时保留条件 hook、缺失依赖与泛型箭头的反例验证。

## DN-35：浏览器声明图与宿主执行类型隔离

- **类型**：类型边界 / 测试分层。
- **位置**：`types.ts`、`write-call.ts`、`job-kinds.ts`、`error-codes.ts`、`fulltext-spill.ts`、`result-contract.ts`、`tsconfig.client*.json`、`scripts/client-declarations.mjs`。
- **行为**：共享 DTO 不导入宿主执行上下文，不扩充宿主 `JobKindMap`，不经全文 spill 回调引入读取实现。写入审批上下文和 job kinds 仅由宿主入口持有。浏览器单独编译且无 Node 全局；浏览器测试在另一个带 Node 测试平台类型的工程编译。声明门禁读取 TypeScript 实际解析的文件清单，拒绝宿主 jobs/tools/agent 根入口与本地宿主执行模块，独立于 `skipLibCheck`。客户端 jobs 直接使用其公开类型；未扩充 Context 的 connection 经 Cordis 严格服务查询取得。
- **测试**：宿主流水线生成四类 scholarly 写入回执，并逐次比对归档 JSON；浏览器只重放这些完整内容和 meta，避免把两种 Context 声明放进同一个程序。更新归档须显式设置 `DSH_CAPTURE_SCHOLARLY_RECEIPTS=1` 运行 capture spec；普通测试只比对。
- **触发条件**：共享类型新增宿主 import、Context 声明或实现模块引用；修改 tool 输出协议；升级 TypeScript 或宿主 jobs 契约。
- **验证**：`client-declarations.spec.ts` 既检查真实浏览器图，也让一个含宿主 job kinds 的真实编译程序触发拒绝；`scholarly-save-receipt-capture`、浏览器回执和写入卡片测试；`npm run typecheck`。
- **后续处理**：新增共享契约时保持类型与执行分离；增加跨端测试时分别验证宿主产出和浏览器重放，保留同一份归档的精确比对。

## DN-36：工具 schema 的默认值注解

- **类型**：上游契约。
- **位置**：`tools/search.ts`、`tools/retrieve.ts` 与已钉 `dsh-tools/src/schema.ts`。
- **行为**：harness 将 `default` 定义为不参与验证的 JSON 注解，不向参数填值。工具自行应用业务默认值，并以参数是否存在校验互斥组合；省略 retrieve mode 的当前契约是 evidence。`Object.hasOwn` 不能区分模型参数与未来校验器填入的自有属性，因此不能作为默认填充的兼容措施。
- **触发条件**：升级 harness 的 schema 作者协议或参数验证器。
- **验证**：`search`、`retrieve-fulltext` 的真实工具管线用例，包含省略 `tagMatch`、省略 mode、fulltext 参数互斥和非法范围。
- **后续处理**：若上游改变默认值语义，同步修改 schema 中影响互斥判定的默认注解与参数规范化，在升级变更中验证；当前不得假定填充行为。

## DN-37：样式门禁读取 CSS 语义

- **类型**：开发约束 / 呈现边界。
- **位置**：`scripts/shared/css-syntax.mjs`、`scripts/style-guard.mjs`、`tests/unit/tooling/style-syntax.spec.ts`。
- **行为**：CSSTree 统一解析规则、声明、值、选择器和媒体条件；tokenizer 保留偏移并识别 CSS 转义，字符串中的注释、分号和括号不参与结构拆分。字体字面量在 `var` fallback 和 `calc` 中同样受检，值需来自宿主阶梯。颜色包括命名色、现代函数和变量 fallback；透明与 currentColor 保留其结构语义。媒体例外必须在相反能力下确定不匹配，OR 和 not 不能放宽 hover/触屏字号条件。动画只在 no-preference 下运行即可；否则减少动态效果时须实际设置对应 transition/animation 为 none，且覆盖完整主体及媒体范围。
- **触发条件**：新增 CSS 语法、宿主样式规则或 CSSTree 升级。
- **验证**：style-guard 原有行为测试与 style-syntax 的转义、结构、命名色、相对字号、逻辑边框、长写圆角和媒体逻辑反例；`npm run style:check`。
- **后续处理**：扩展语法支持时修改共享解析层，并保留有效写法与绕过写法的成对用例；不得以扩大例外恢复绿灯。

## DN-38：依赖与运行时发布身份

- **类型**：供应来源 / 发布边界。
- **位置**：`scripts/shared/onnxruntime-release.json`、`onnxruntime-LICENSE`、`vendor-onnxruntime.mjs`、`harness-state.mjs`、`published-declarations.mjs`、`verify-pack.mjs`。
- **行为**：ONNX 1.31.1 的独立锚点来自官方 npm 元数据的 tarball SHA-512；实际归档通过该 SRI 后，提取三个资产的 SHA-256。许可证从对应上游版本取得并固定摘要。vendor 和 pack 检查同时对比独立锚点，修改资产与生成 provenance 不能共同绕过验证。版本升级须重新取得并核对上游归档和许可证，不能从安装树生成新锚点。直接运行时依赖采用精确版本；安装策略承诺限定于发布时检查的解析闭包，宿主仍需检查未来传递解析。vendored harness 包的版本从不可变 pin tag 读取，锁文件解析必须等于声明地板，不能仅满足宽范围。
- **声明**：每个打包声明中的静态 import、export 和 import type 都须有 consumer dependencies、optionalDependencies 或 peers；开发依赖不能满足消费者契约。缺失 client 产物、坏 manifest、缺 tag 与 tag 内缺文件分别报告；废弃 harness 包名使门禁失败。
- **触发条件**：ONNX、harness、运行时依赖或打包声明升级。
- **验证**：`vendor-onnxruntime` 的同步篡改反例和许可证内容校验、`harness-vendor-state` 的 pin/工作树分歧实仓库用例、`harness-state` 的锁定版本反例、`published-declarations` 与实际 `verify:pack`。
- **后续处理**：更新独立来源证据后重新运行完整发布门禁；版本、SRI、文件摘要与许可证须作为同一变更审核。

## DN-39：轨迹 PDF 租约与客户端适配约束

- 类型：生命周期约束；位置：`src/client/url-pdf-readers.ts`。
- 行为：持久目录版本 2 只保存文件 ref，最多 256 条；租约只属于本次浏览器会话。同地址替换先接管新租约，再释放旧租约；旧释放完成不能删除新记录。解绑目录不丢弃仍须清理的租约；并发 dispose 共用清理结果。
- 复查触发：宿主恢复标签或 reading-file 租约协议变化。
- 验证：`tests/client/library/pdf-reader-lifetime.spec.ts` 中的替换、持久化失败、恢复与并发退出用例。
- 后续动作：宿主提供跨会话租约所有权协议时再调整目录；升级前维持会话所有权。

## DN-40：宿主交付按钮的私有路由适配

- 类型：上游呈现协议适配；位置：`DeliverableZoteroAction.tsx`。
- 行为：当前 pin 的 `deliverables.file.actions` 不提供文件 path。按钮仅接受 `api/present.open` 的单一 `sessionId`、正整数 `seq`、非负整数 `index`，再通过 ChatSnapshot 定位交付文件；未知路由或坐标由客户端 logger 明确报告。文件右键菜单同时保留。此适配不是公开的宿主 URL 契约。
- 复查触发：harness pin、present-open 路由或 slot owner props 变化。
- 验证：`tests/client/deliverables/`；发布前运行 `npm run smoke:web-composition`。
- 后续动作：上游公开 path/文件身份后改用该字段，并删除路由解析与本条约束。

## DN-41：客户端平台验证的版本范围

- 类型：版本验证边界；位置：构建平台模块表、harness pin 与浏览器组合探针。
- 行为：具名导出、类型与真实 SlotTestRuntime 仅对精确 pin 验证；`engines.dsh` 的版本区间不是对其中每个宿主版本的实测证明。发布及每次宿主升级均须运行 `npm run smoke:web-composition`，保留报告与控制台异常记录。
- 复查触发：宿主升级、平台依赖或客户端值导入变化。
- 验证：`harness:check`、真实客户端 runtime 测试、`smoke:web-composition` 与功能 DOM 测试共同覆盖各自边界；浏览器探针不替代每个业务控件的验收。
- 后续动作：宿主提供跨版本契约矩阵后扩展实测范围；仍按实际测试版本报告保证范围。

## DN-42：按钮样式的归属与内容行布局

- 类型：上游控件布局适配；位置：`ContentButton.tsx`、`IconButton.module.css`、`control-style-ownership.mjs`。
- 行为：当前 pin 的 Button 只有固定块高的 `md`/`sm`，没有自适应内容高度参数。多行文献条目使用 ContentButton，唯一的宿主覆盖是原生 `style.height="auto"`；行的标题、元数据与内容内边距决定高度，宿主继续提供字号、横向内边距、圆角、hover 和焦点样式。单行附件、章节标题和普通按钮直接使用宿主 Button，保留原生高度。选中装饰属于条目外框。图标尺寸与窄容器中的图标席位由共用 IconButton 适配样式管理，业务样式不覆盖其颜色或几何。
- 复查触发：宿主 Button 增加内容高度或图标按钮 API、尺寸阶梯变化，或新增控件包装器。
- 验证：样式门禁从 JSX 导入与 className 绑定追踪到 CSS 规则，拒绝业务控件的几何、填充、字体与颜色覆盖；无法解析的动态 CSS 类明确失败。ContentButton 只放行 `height:auto`，图标适配文件只放行其尺寸与圆角属性；负例验证覆盖这两处受限适配。真实浏览器验收须检查长标题、紧凑密度、PDF 徽标与窄面板。
- 后续动作：宿主提供对应布局 API 时替换适配并移除受限放行；保留业务样式的归属门禁。

## DN-43：结果投影与宿主快照

- **类型**：上游契约约束。
- **位置**：`src/result-delivery.ts`，宿主 tools pipeline 的 `createSuccessResult`。
- **行为**：宿主在验证与投影前复制并冻结工具结果，不能用原结果对象的 WeakMap 保存后续投影所需事实。inline 臂在最终 `presentationMeta` 中计算一次；file 臂在确定需要文件后计算一次并随收据保留。事件元数据只展开一份事实。
- **复核触发**：升级 tools pipeline、调整结果包装或投影时。
- **验证**：`tests/host/result-projection.spec.ts` 经真实工具执行链，分别断言 inline/file 投影器仅调用一次，元数据没有嵌套 facts 或会话标识副本。
- **后续动作**：若上游提供可保留的调用级投影接口，按该接口重审交付层；保留两臂的执行链回归。

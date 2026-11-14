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

## 升级复核

每次 harness pin 变更都从本文开头逐条核对：上游契约是否已经提供期望能力；提供了就必须在同一次改动中完成迁移并退役条目，不允许“能力已到、绕行还在”的状态长期存在。没有提供能力时，只更新 pin 版本号与复核日期，不修改绕行实现。

## 已退役条目

目前没有。退役条目保留标题、退役时间和替代机制，便于回溯为什么曾经这样做。

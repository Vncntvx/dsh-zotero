<p align="right"><a href="architecture.en.md"><b>English</b></a></p>

# 系统架构

## 概述

dsh-zotero 是基于 Cordis 的服务插件，向宿主环境暴露 `ctx.zotero` 服务边界。加载器将默认导出的 `ZoteroService` 与校验后的配置一同挂载。

## 数据流

```mermaid
graph LR
    U[用户] --> A[Agent]
    A --> T[dsh Zotero 工具]
    T --> S[ZoteroService]
    S --> P[Provider]
    P --> Z[Zotero Local API<br/>127.0.0.1:23119]
    Z --> L[Zotero 文献库]
```

## 核心分层

### 服务层 (`src/service.ts`)

- `ZoteroService` 扩展 Cordis `Service`，注册为 `ctx.zotero`；
- 负责 Provider 调度、能力门控与领域操作统一入口；
- 配置以 Loader entry 为基准，设置变更通过 `loader/volatile-update` 提交到同一 entry；
- 结构性配置变更会在现有实例上重建 HTTP 客户端、Provider 与写工具集，触发条件是 `TRANSPORT_CONFIG_KEYS` 中的六个键（`baseUrl`、`timeoutMs`、`maxResponseBytes`、`maxInFlightRequests`、`writeAuthorizeDeadlineMs`、`writeEnabled`）；其余限额由 Provider 实时读取，不触发重建；
- 写入闸门统一收敛于服务接缝：所有写操作接收 `ZoteroWriteCall`，依次通过能力检查、会话审批策略（`ctx.approval.request`）以及计划审查卡；
- 注册 `tools/pre-execute` 监听器，检测直写本地 API 的 shell 命令并提升为审批请求；
- 请求驱动架构：插件加载过程不发起任何外部或本地网络请求。

### Provider 层 (`src/local/provider.ts`)

- `LocalApiProvider` 实现 `ZoteroProvider` 接口；
- 提供 search、metadata、attachments、citation、browse、retrieve、changes 等核心能力，写入能力仅在明确配置且授权就绪时提供；
- 搜索与浏览的作用域名称由插件基于缓存的列表数据自行解析；缓存列表由 scope directory 持有，并随传输层一同重建；
- 读路径的并发由 `searchConcurrency`、`graphConcurrency` 两个限额约束，避免单次调用对本地 API 造成瞬时过载；
- 笔记内容扫描在第一页（offset 0）按限额执行；
- 原文片段基于 BM25 词频算法排序；
- 导出服务遵循 Zotero 本地接口的单次请求限制：`bibtex`、`biblatex`、`ris`、`csljson` 四种批量格式都只分批取一次条目（`itemKey` 单次上限 50 条），不再为每条单独抓取；`ris`/`csljson` 只需该次批请求，`bibtex`/`biblatex` 另外并行发出一次元数据批请求（`fetchRawItemBatch`），用于把导出结果对齐到各条目；
- 写入领域支持跨库文献关系（`dc:relation`），群组库条目自动映射至规范的 `http://zotero.org/groups/<id>/items/<key>` URI。

### 后台任务引擎 (`src/job-runner.ts`)

- 深度集成 Harness `ctx.jobs` 任务子系统；
- 支持显式后台执行（`run_in_background: true`）与前台等待超时自动提升（`promoteOnTimeout: true`，受 `foregroundWaitMs` 控制）；
- 信号分离机制：后台任务拥有独立的 `AbortController` 信号，调用方轮次超时或取消时，已发布的后台任务继续运行；
- 通道隔离机制：流式进度通过 `{ channel: 'log' }` 向 Web 顶栏与日志流汇报，不污染模型上下文；任务完成后结果写入 `JobOutcome.result`；
- 按需启动与释放，不运行常驻轮询守护进程。

### HTTP 传输层 (`src/http-client.ts`)

- 仅支持环回地址 HTTP 请求，固定 API 版本为 3；
- 通过 `Zotero-Server-ID` 请求头校验实例身份一致性；
- 强制限制流式响应读取大小（`maxResponseBytes`）；
- 全局在途请求上限（`maxInFlightRequests`，默认 8），统一管理所有工具调用的并发槽位；
- 严格禁止重定向，无持久长连接；
- 超时由融合后的 deadline 与调用方取消信号共同管理。

### 原文片段检索管线 (`src/evidence.ts`)

- 分词机制：采用 `Intl.Segmenter` 进行词分割（支持 CJK），词元经与 Zotero 保持一致的 `normalizeForSearch` 规则折叠；折叠仅作用于检索匹配侧，原文保持原样输出；
- BM25 排序参数为 k1=1.2, b=0.75；
- 词频统计以条目内部片段集合为语料基准；
- 排除零分段落：与查询没有任何词项重合的段落不计入结果，因此无重合的查询返回空列表，而不是任意摘录。

### 学术文献子系统 (`src/scholarly/`，可选组件)

`dsh-zotero/scholarly` 是一个独立的 bundle 组件（`cordis.patch.yml` 中默认随插件一同启用），注册 `ctx.scholarly` 与六个检索工具。它与 Zotero 本地路径完全隔离：所有请求发往外部学术索引，与 `ctx.zotero` 的唯一交叉点是「这封信是否已在本地库」的只读标注。

- **主机白名单**：`src/scholarly/transport/hosts.ts` 是唯一真源。允许的 host 集合与每主机限流间隔都从 `SCHOLARLY_HOSTS` 派生，`allowlist.ts` 不再自带一份列表——两份列表曾经互相矛盾（最忙的 `api.openalex.org` 没有限流条目，而适配器实际调用的是 `export.arxiv.org`）。
- **传输层**：截止时间用 `@deepseek-ai/dsh-timeout` 的 `deadline()` / `timeoutOf()`，因此「provider 超时」与「调用方取消」是两件可分辨的事（后者不重试）；响应体上限用共享的 `src/transport-bounds.ts`，与本地传输同一实现、同一 16 MiB 上限；在飞请求数由 `ConcurrencyGate` 约束。
- **凭证**：三个 `role('secret')` 声明的 API Key 中，Semantic Scholar 与 OpenAlex 走请求头（`x-api-key` / `Authorization: Bearer`）；NCBI E-utilities 只接受 query 参数，因此该密钥经 URL 传递，代价由传输层承担——`ScholarlyHttpError` 只携带 host，拒绝消息也只报 hostname，绝不内插完整 URL。
- **全文缓存**：`src/scholarly/fulltext/store.ts` 在 `dshCachePath('zotero-scholarly')` 下按 key 存一份 JSON 正文，内存只保留 8 条索引。不使用 `ctx.storageDomain`：其 `KvTable.get()` 是整表常驻内存的同步读，而单篇正文可达 200 KB。读结果分三态（`hit` / `miss` / `corrupt`），损坏条目会被驱逐并记录，不会被当作「没有」。
- **失败语义**：全文解析的每条路由各自记录失败原因，终态错误逐条列出（`Tried: …`）；`scholarly_verify` 用四值结论（`verified` / `check` / `not_found` / `unverified`）区分「注册表说没有」与「注册表联系不上」——后者若报成前者，用户会删掉一条正确的引用。
- **公开面**：`src/scholarly/index.ts` 只导出服务类、配置 schema 与领域类型；传输、主机表、存储与融合内部实现均不导出。

### 浏览器客户端 (`src/client/`)

- 组合包配置（`plugins.bundle.config`）：在插件管理器详情页注册完整的 Zotero 配置表单，通过 harness 官方 `SettingsForm` 与 `SettingsFormModel` 统一管理；
- 会话面板（`conversation.view`）：会话标签页只有一个 Zotero 面板，顶部透镜栏在文献工作区与会话级导出页之间切换；每个条目的检查器内含概览（Overview）、原文片段（Passages）与该条目导出结果（Exports）三个面板；
- 工具卡片（`tool.call.toolview`）：为 16 个模型工具（8 读 + 8 写）各提供紧凑折叠卡片，对值得复制的取值提供复制按钮，通过“阅读 PDF”在侧边栏阅读原文，并提供复制标题或规范深链的定位操作。卡片只渲染工具已有的输出，自身不调用工具；
- 命令状态卡片（`conversation.chat.commandview`）：为 `/zotero` 输出提供连接状态灯、版本与 Server ID 明细、离线排查建议与就地刷新按钮。结构化事实来自宿主注册的 `zoteroStatus` 会话投影：命令处理器将同一份状态投影为 `zotero/status` 会话事件并以 `sourceEventSeq` 指向它，卡片经 `useProjection` 读回，命令文本只作人类可读答案、不再被解析。就地刷新发起的实时探测优先于投影（它是更新的答案）；
- `webEnabled` 开关保存后即时生效。

#### 工具参数读取与双层错误边界

- **参数读取**：卡片与 Sources 归约器统一通过 `src/client/presenters.ts` 的 `argsViewOf(block)` 读取 `block.args`；上游 dsh 0.2.1-rc.2 契约保证调用头与结果块均携带非可选的 `ToolArgs`（`PartialArguments`）。
- **双层错误边界**：插件注册两层错误边界：
  - **Surface 级（`ZoteroSurfaceBoundary`）**：包裹 Sources 标签页（`conversation.view`），渲染异常时就地显示错误提示与「刷新」（`t('refresh')`）按钮，并通过 `resetKey={sessionId}` 在会话切换时自动重置；
  - **Card 级（`ZoteroCardBoundary` / `withCardBoundary`）**：包装全部 16 个工具卡片（`tool.call.toolview`）。卡片渲染异常时就地降级为紧凑警告行，保留在对话流中。降级视图仅读取工具名、文案与错误消息等纯字符串，不访问 block 字段；卡片异常大多由块数据异常引发，降级视图本身不抛错，可避免未捕获异常逃逸至上游插槽边界导致卡片停用。

### 远程通信与设置

- 宿主半侧在 `zotero` wire 命名空间下注册 `ZoteroRuntime`，端点返回实时连接视图（`status`）、附件落点解析（`resolveAttachment`）、诊断快照（`diagnostics`）与客户端崩溃上报（`reportClientError`）；配置读写走 harness 的共享设置表单，不经过该通道；
- 浏览器半侧自行挂载该命名空间：`apply` 先 `ctx.remote.$mount(ZOTERO_REMOTE)`，再在声明了 `remote.zotero` 的 fiber 上（`ctx.inject(['remote.zotero', …], registerUi)`）注册全部界面并直接读 `ctx.remote.zotero`。挂载失败不吞掉：入口 reject，由 harness 报告插件加载失败；
- 配置全字段声明为 `volatile`，支持热重载。

### 诊断与日志

插件维护一份容量为 500 条的进程内诊断环形缓冲（`src/diagnostics.ts`），集中记录运行时错误、功能降级与渲染崩溃：

- **记录来源**：各关键接缝（HTTP 请求、工具调用、Job 状态、配置变更、写门禁、Shell 拦截、连接探测、降级事件）通过 `DiagnosticSink` 写入结构化条目。服务在装配时挂载随 fiber 生命周期的日志导出器，按名称前缀捕获插件子树产生的 `ctx.logger` 输出（涵盖接缝使用的 `zotero.*` 以及 Cordis 派生的 `zotero-service` 命名空间），收集匿名访问与生命周期相关日志；
- **保留级别**：默认不开启诊断模式时不显示诊断面板；在设置中开启「诊断模式」（`debug`）后在详情页底部显示诊断卡片，并额外记录请求行与调用摘要等细节。连续出现的相同条目会合并并递增 `count`，避免重复报错刷屏，单条消息和详情字段均设有长度限制；
- **读取接口**：`zotero/diagnostics` 端点按时间倒序返回快照（包含总数、截断标记与 debug 开关状态）。因 Harness 转发事件白名单未向插件开放，前端诊断卡仅在开启诊断且面板可见时通过定时轮询更新状态；
- **前端异常上报**：两条通道覆盖两组互不相交的崩溃，均写入同一环形缓冲，使宿主与前端报错集中可查：
  - **组件错误边界**：`ZoteroSurfaceBoundary` 与 `ZoteroCardBoundary` 就地隔离各自包含的渲染崩溃，经注册期绑定的上报接口记录异常（触发界面、错误消息与调用栈）。class 组件由插槽渲染器挂载、拿不到注入 face，模块级绑定是它们到达网关的唯一通道；
  - **Slot 监督通道**：`ctx.slots.onEntryError` 兜底记录边界看不到的崩溃（`inject` 工厂抛错、无自有边界表面的抛错、Factory occurrence），按注册时盖的 `registrant` 所有权戳过滤，只认本插件条目。React 的错误边界在抛错点向上找最近的 class 边界，因此被插件边界包含的崩溃不会到达外层 harness 边界，反之亦然；
- **界面呈现**：开启诊断后，插件详情页底部的诊断卡支持日志级别过滤、展示最新条目与截断提示，并提供诊断包一键复制功能（包含插件版本、Zotero 连接信息、debug 状态及全部缓冲条目）；
- **数据安全**：所有记录仅保存在内存中，不落盘、不外发遥测。敏感凭据不经过接缝；HTTP 记录仅包含请求方法、路径、状态码与耗时，查询参数仅在 `debug` 级别记录且受长度截断，响应体与文献正文一律不进入缓冲区。

## 设计边界

- **文献库权限**：默认只读；开启 `writeEnabled` 后仅允许写入个人库（`zotero://user/0/`）；
- **网络边界**：严格限制在环回地址（`127.0.0.1`、`localhost`、`::1`），拒绝任何外部网络访问与 HTTP 重定向；
- **进程管理**：无后台轮询守护进程与遥测收集，长任务统一交由 `ctx.jobs` 按需管理；
- **段落排序**：对条目自身的片段语料做 BM25 词频匹配，不使用向量或嵌入模型；
- **会话快照**：Sources 面板展示当前会话涉及的文献快照。

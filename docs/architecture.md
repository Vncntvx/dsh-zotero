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
- 连通性恢复门控（`ConnectivityRecovery`）与服务实例同生命周期，避免并发失败堆叠询问；
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

### 浏览器客户端 (`src/client/`)

- 设置页（`settings.section`）：在设置面板左侧导航注册独立的 Zotero 配置页；
- 会话面板（`conversation.view`）：会话标签页只有一个 Zotero 面板，顶部透镜栏在文献工作区与会话级导出页之间切换；每个条目的检查器内含概览（Overview）、原文片段（Passages）与该条目导出结果（Exports）三个面板；
- 工具卡片（`tool.call.toolview`）：为 16 个模型工具（8 读 + 8 写）各提供紧凑折叠卡片，对值得复制的取值提供复制按钮，并提供跳转 Zotero 的深链。卡片只渲染工具已有的输出，自身不调用工具；
- 命令状态卡片（`conversation.chat.commandview`）：为 `/zotero` 输出提供连接状态灯、版本与 Server ID 明细、离线排查建议与就地刷新按钮；
- `webEnabled` 开关保存后即时生效。

### 远程通信与设置

- 宿主半侧在 `zotero` wire 命名空间下注册 `ZoteroRuntime`，其唯一端点返回实时连接视图；配置读写走 harness 的共享设置表单，不经过该通道；
- 浏览器半侧自行挂载该命名空间：`apply` 先 `ctx.remote.$mount(ZOTERO_REMOTE)`，再在声明了 `remote.zotero` 的 fiber 上（`ctx.inject(['remote.zotero', …], registerUi)`）注册全部界面并直接读 `ctx.remote.zotero`。挂载失败不吞掉：入口 reject，由 harness 报告插件加载失败；
- 配置全字段声明为 `volatile`，支持热重载。

## 设计边界

- **文献库权限**：默认只读；开启 `writeEnabled` 后仅允许写入个人库（`zotero://user/0/`）；
- **网络边界**：严格限制在环回地址（`127.0.0.1`、`localhost`、`::1`），拒绝任何外部网络访问与 HTTP 重定向；
- **进程管理**：无后台轮询守护进程与遥测收集，长任务统一交由 `ctx.jobs` 按需管理；
- **段落排序**：对条目自身的片段语料做 BM25 词频匹配，不使用向量或嵌入模型；
- **会话快照**：Sources 面板展示当前会话涉及的文献快照。

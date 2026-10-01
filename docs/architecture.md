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
- 结构性配置变更（如传输层与写入开关）在现有实例上重建 HTTP 客户端、Provider 与写工具集；限额变更由 Provider 实时读取，不触发重建；
- 连通性恢复门控（`ConnectivityRecovery`）与服务实例同生命周期，避免并发失败堆叠询问；
- 写入闸门统一收敛于服务接缝：所有写操作接收 `ZoteroWriteCall`，依次通过能力检查、会话审批策略（`ctx.approv al.request`）以及计划审查卡；
- 注册 `tools/pre-execute` 监听器，检测直写本地 API 的 shell 命令并提升为审批请求；
- 请求驱动架构：插件加载过程不发起任何外部或本地网络请求。

### Provider 层 (`src/local/provider.ts`)

- `LocalApiProvider` 实现 `ZoteroProvider` 接口；
- 提供 search、metadata、attachments、citation、browse、retrieve、changes 等核心能力，写入能力仅在明确配置且授权就绪时提供；
- 客户端侧解析搜索与浏览的作用域名称；
- 读路径采用有界并发与分片并发控制，避免对本地 API 造成瞬时过载；
- 笔记内容扫描在第一页（offset 0）按限额执行；
- 证据片段基于 BM25 词频算法排序；
- 导出服务遵循 Zotero 本地接口的单次请求限制，批量导出（`bibtex`、`biblatex`、`ris`、`csljson`）采用 Zero-N+1 内存切分引擎（$O(1)$ HTTP 请求，`ris`/`csljson` 单次批请求，`bibtex`/`biblatex` 2 次并行批请求），完全消除单条二次抓取；
- 写入领域支持跨库文献关系（`dc:relation`），群组库条目自动映射至规范的 `http://zotero.org/groups/<id>/items/<key>` URI。

### 后台任务引擎 (`src/job-runner.ts`)

- 深度集成 Harness `ctx.jobs` 任务子系统；
- 支持显式后台执行（`run_in_background: true`）与前台等待超时自动提升（`promoteOnTimeout: true`，受 `foregroundWaitMs` 控制）；
- 信号分离机制：后台任务拥有独立的 `AbortController` 信号，调用方轮次超时或取消不影响已发布的后台任务；
- 通道隔离机制：流式进度通过 `{ channel: 'log' }` 向 Web 顶栏与日志流汇报，不污染模型上下文；任务完成后结果写入 `JobOutcome.result`；
- 按需启动与释放，不运行常驻轮询守护进程。

### HTTP 传输层 (`src/http-client.ts`)

- 仅支持环回地址 HTTP 请求，固定 API 版本为 3；
- 通过 `Zotero-Server-ID` 请求头校验实例身份一致性；
- 强制限制流式响应读取大小（`maxResponseBytes`）；
- 全局在途请求上限（`maxInFlightRequests`，默认 8），统一管理所有工具调用的并发槽位；
- 严格禁止重定向，无持久长连接；
- 超时通过 deadline 融合与调用方取消信号协同管理。

### 证据提取管线 (`src/evidence.ts`)

- 分词机制：采用 `Intl.Segmenter` 进行词分割（支持 CJK），词元经与 Zotero 保持一致的 `normalizeForSearch` 规则折叠；折叠仅作用于检索匹配侧，原文保持原样输出；
- BM25 排序参数为 k1=1.2, b=0.75；
- 词频统计以条目内部片段集合为语料基准；
- 排除零分段落，确保输出与查询具有文本相关性。

### 浏览器客户端 (`src/client/`)

- 设置页（`settings.section`）：在设置面板左侧导航注册独立的 Zotero 配置页；
- 会话面板（`conversation.view`）：在会话标签页提供文献（Sources）、证据（Evidence）与导出（Exports）三视图；
- 工具卡片（`tool.call.toolview`）：为 16 个模型工具（8 读 + 8 写）提供专属紧凑折叠卡片，展开展示结构化数据并支持复制和打开链接；
- 命令状态卡片（`conversation.chat.commandview`）：为 `/zotero` 输出提供连接状态灯、指标面板、离线排查建议与就地刷新按钮；
- `webEnabled` 开关保存后即时生效。

### 远程通信与设置

- `ZoteroRuntime` 通过 wire 命名空间向 Web 端提供实时状态连接；
- 配置全字段声明为 `volatile`，支持热重载。

## 设计边界

- **文献库权限**：默认只读；开启 `writeEnabled` 后仅允许写入个人库（`zotero://user/0/`）；
- **网络边界**：严格限制在环回地址（`127.0.0.1`、`localhost`、`::1`），拒绝任何外部网络访问与 HTTP 重定向；
- **进程管理**：无后台轮询守护进程与遥测收集，长任务统一交由 `ctx.jobs` 按需管理；
- **证据排序**：基于 BM25 词频匹配，非向量语义嵌入；
- **会话快照**：Sources 面板展示当前会话涉及的文献快照。

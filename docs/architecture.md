<p align="right"><a href="architecture.en.md"><b>English</b></a></p>

# 架构

## 概述

dsh-zotero 是一个 Cordis 服务插件，提供 `ctx.zotero` 服务边界。加载器将默认导出与行的验证配置一起挂载。

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

用户 → Agent → dsh Zotero 工具 → ZoteroService → Provider → 127.0.0.1 Zotero Local API → Zotero 文献库

## 关键层

### 服务层 (`src/service.ts`)

- `ZoteroService` 扩展 `Service`，注册为 `ctx.zotero`
- 负责 provider 选择、能力门控、领域方法
- 配置以 Loader entry（composition entry）为唯一权威；settings 提交经 `loader/volatile-update` 落到同一 entry
- 结构性 volatile 更新通过私有 `buildTransport()` 在**同一** `ZoteroService` 实例上重建 HTTP client、local provider 与写工具集；纯限额更新由 provider 实时读取，不重建 transport
- 连接恢复门（`ConnectivityRecovery` / `service.recovery`）与服务实例同寿命，**不**随 settings rebuild 重置（避免并发失败叠卡）
- 写入闸门在**服务接缝**上：三个写方法要求一个 `ZoteroWriteCall`（计划文本 + 发起调用的 agent/信号），先过能力门再弹计划卡，未批准返回 `declined`，无通道则失败关闭；写工具不再自己发起计划审查
- 通过 `tools/pre-execute` 监听器把 shell 直写 Zotero 本地接口的调用抬成 harness 审批请求（`src/shell-write-detector.ts`，无开关）：确认才执行一次，拒绝 / 取消 / 策略为 `never` / 无通道都不执行。检测只读命令文本，理由与盲区见写入边界
- 请求驱动：加载从不触及 Zotero

### Provider 层 (`src/local/provider.ts`)

- `LocalApiProvider` 实现 `ZoteroProvider`
- 能力：search、metadata、attachments、citation、browse、retrieve、changes；写入能力只在 transport 与 authorizer 均接线时提供
- 客户端侧解析作用域（Local API 无服务端名称搜索）
- 读路径的扇出并行执行，机制按域不同：一个 key 的 children 两半走 `Promise.all`（`src/local/detail.ts`）；retrieve 的附件集与 export 的逐文档请求走有界并发（`ZOTERO_GRAPH_CONCURRENCY` / `ZOTERO_EXPORT_CONCURRENCY`）；browse 的祖先解析与 changes 的 items 三分区走 `Promise.all` / `Promise.allSettled`。写路径的往返下限（建笔记一次 POST、不回读）见 [工具文档](./tools.md) 的写入边界
- 笔记体扫描：客户端侧第一页（offset 0），受 maxNoteScanRecords 限制
- 证据排名：基于 passage 语料库的 BM25（annotations、notes、abstract、fulltext chunks）
- 导出：引用批次遵循 API 的 50 键上限；translator 格式最多 50 条引用

### HTTP 传输层 (`src/http-client.ts`)

- 纯回环 fetch，固定 API 版本（`Zotero-API-Version: 3`）
- 实例身份保护（`Zotero-Server-ID` 头）
- 流式响应字节上限（`maxResponseBytes`）
- 全实例在途请求上限（`ZOTERO_MAX_INFLIGHT_REQUESTS`，默认 8）：各域并发池只约束单次调用的扇出，多个并行工具调用会相乘，因此由 HTTP 客户端统一持有槽位（连接、响应体、流式读取全程），排队请求可被调用方取消，请求超时从拿到槽位后开始计时（排队不计入超时）
- 不跟随重定向、不保持连接、无后台工作
- 超时通过 deadline 融合与调用者取消实现

### 证据管线 (`src/evidence.ts`)

- 分词：`Intl.Segmenter` 词分割（CJK 感知），词元先按 Zotero 自身的 `normalizeForSearch` 折叠（音调符号、NFKD 特殊字母、排版引号/破折号、格式标签），与服务器侧搜索的判据一致；折叠只作用于匹配侧，原文不被改写
- BM25 排名（k1=1.2, b=0.75）在 passage 语料库上
- 文档频率是 passage 级别（在条目自身 passages 中越罕见得分越高）
- 平局保留调用者 passage 顺序（确定性）
- 零分 passage 排除（未命中查询词的 passage 不进入结果）

### 浏览器客户端 (`src/client/`)

- 配置页：`settings.section` 插槽（设置面板左侧导航的独立一项），经 `ctx.configForms.get` 读 `zotero` 命名空间的共享表单
- Sources tab：`conversation.view` 插槽，文献/证据/导出的会话快照
  - Sources 子视图：搜索命中和引用条目的稳定联合
  - Evidence 子视图：按文献分组的段落，带 Zotero 的页标签
  - Exports 子视图：成功导出的产物，带格式/样式/区域设置
- 连接条：tab 打开时探测一次，刷新时再探测一次（无轮询）
- `zotero://` 深链接："在 Zotero 中打开"、"打开 PDF"、"打开批注"
- `webEnabled` 开关：实时生效，无需重新加载

### Remote/Typert

- `ZoteroRuntime` 通过 wire 命名空间为 web tab 提供实时连接性
- 严格 manifest 通过 Typert 注册表声明端点

### 设置

- 命名空间 `zotero` 在 Loader entry（composition entry 即唯一权威）
- 全字段 `volatile`：限额字段由 provider 实时读取；transport 字段或写入开关等结构字段变化时，`loader/volatile-update` 在同一服务实例上重建传输栈与写工具集，provider id 则在调用时实时选择

## 设计边界

- **文献库**：默认只读；`writeEnabled` 显式打开后可写个人库（笔记、标签、入藏）。写路径见写入边界。
- **网络**：仅回环（127.0.0.1, localhost, ::1）。拒绝重定向。
- **无后台轮询**、无遥测、无常驻任务。
- **证据**：基于词项的 BM25，按查询词与 passage 的词频匹配度排序。
- **Sources tab**：会话快照，展示本次对话引用的条目。
- **导出**：工具以文本形式返回（模型读到的就是它）；面板提供复制与文件下载。
- **PDF 阅读**：附件返回路径/URL；进一步阅读需要宿主能力。路径属于运行 Zotero 的那台机器。loopback 限制保证插件与 Zotero 同机，但宿主的文件读取可能跑在别的执行环境（sandbox、容器、远程主机），那时该路径不可见，工具结果会注明环境。插件不会通过开放 Zotero 无认证端口来解决远端访问。

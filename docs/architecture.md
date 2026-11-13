<p align="right"><a href="architecture.en.md"><b>English</b></a></p>

# 系统架构

## 概述

dsh-zotero 是基于 Cordis 的服务插件，向宿主环境暴露 `ctx.zotero` 服务边界；文献面板另有 `ctx.zoteroLibrary`，学术检索另有 `ctx.scholarly`。加载器将默认导出的 `ZoteroService` 与校验后的配置一同挂载。插件是请求驱动的：加载过程不发起任何外部或本地网络请求。

## 数据流

```mermaid
graph LR
    U[用户] --> P[文献面板]
    A[Agent] --> T[dsh Zotero 工具]
    P --> LS[zoteroLibrary]
    T --> S[ZoteroService]
    LS --> S
    S --> PR[LocalApiProvider]
    PR --> Z[Zotero Local API<br/>127.0.0.1:23119]
    Z --> L[Zotero 文献库]
    A -.->|工具调用快照| TR[文献轨迹]
```

## 组件与边界

| 组件                    | Cordis 键                                 | 设置命名空间 | 默认 | 职责                                 |
| ----------------------- | ----------------------------------------- | ------------ | ---- | ------------------------------------ |
| `dsh-zotero`            | `zotero`（wire 命名空间 `zotero`）        | `zotero`     | 启用 | 连接、模型工具、文献轨迹、设置页     |
| `dsh-zotero/library`    | `zoteroLibrary`（wire 命名空间 `zotero`） | `library`    | 启用 | 文献面板的宿主端点与右侧边栏界面     |
| `dsh-zotero/scholarly`  | `scholarly`                               | `scholarly`  | 关闭 | 外部学术索引检索与全文读取           |
| `dsh-zotero/enrichment` | `enrichment`                              | `enrichment` | 关闭 | 主动解析、产物查询与本地语义模型管理 |

核心持有数据面与 Agent 能力；文献面板组件没有工具、没有提示词段，本地库端点转交核心，显式 URL PDF 阅读使用独立授权与共享公网传输校验，拆出来是为了可整体关闭并拥有独立设置。学术检索组件是 Agent 外部检索授权边界，未挂载时服务、传输层与工具都不存在。启用文档解析组件即接受 MinerU 文档外发，并使解析和模型管理能力可用；每次上传仍须用户提交具体文档并通过会话门禁。其接入方式是只读产物查询与独立的主动解析操作，均不注册模型工具或提示词段。

## 核心分层

### 按需研究 SOP 技能

`src/skills/` 向 Harness 可选 `ctx.skills` 注册 8 个研究 SOP 技能：核心服务持有单篇速读、证据比较、写作对账和文库治理，Scholarly 组件持有主题版图、引文脉络、真伪审查和文献入库。每个 SOP 的 Markdown 正文仅按需加载；短目录常驻，完整正文不写入 system prompt。组件 fiber 管理注册/注销，registry 后挂载或替换时自动重绑。详见[研究 SOP 技能参考](skills.md)。

子 Agent 写面同时包含 15 个核心工具和 `scholarly_save_to_zotero`。`tools/change` 刷新只覆盖已注册名称的 scoped restriction，适配 Scholarly 后挂载/卸载；基于会话血缘的执行 guard 在展示限制失败时仍拒绝子 Agent 按名称调用写工具。

### 服务层 (`src/service.ts`)

- `ZoteroService` 扩展 Cordis `Service`，注册为 `ctx.zotero`；
- 负责 Provider 调度、能力门控与领域操作统一入口；
- 配置以 Loader entry 为基准，设置变更通过 `loader/volatile-update` 提交到同一 entry；
- 结构性配置变更会在现有实例上重建 HTTP 客户端、Provider 与写工具集，触发条件是 `TRANSPORT_CONFIG_KEYS` 中的六个键（`baseUrl`、`timeoutMs`、`maxResponseBytes`、`maxInFlightRequests`、`writeAuthorizeDeadlineMs`、`writeEnabled`）；其余限额由 Provider 实时读取，不触发重建；
- 写入闸门统一收敛于服务接缝：所有写操作接收 `ZoteroWriteCall`，依次通过能力检查、会话审批策略（`ctx.approval.request`）以及计划审查卡；
- 注册 `tools/pre-execute` 监听器，检测直写本地 API 的 shell 命令并提升为审批请求：`bash`/`pwsh` 读 `command`，`terminal_send` 读提交前的 `text`（`submit: false` 不执行即不检测）；`run_code` 的程序可在运行期拼出请求，属文本检测的已知盲区；
- 策略提示词段（`zotero:policy`，`src/prompt.ts`）随每一步准入的工具集合裁剪：读路由、读上限与写策略只点名该步准入的工具；只要存在任一 Zotero 工具，就保留调用同意、注入防护与连接失败三段；没有本地读工具时保留写路由约束，准入为空时只保留该约束；写能力关闭时完整保留关闭状态说明与越界路由禁令；全量工具时文本保持稳定；
- 配置重建策略与 config→limits 投影集中于 `src/service-config.ts`；本地工具注册清单由 `src/tool-registration.ts` 管理，工具调用诊断 hook 由 `src/tool-diagnostics.ts` 安装，步骤准入解析由 `src/step-tools.ts` 每步缓存一次，参数纠错由 `src/parameter-correction.ts` 通过 `tools/post-execute` 安装，`ResultDelivery` 只负责投递；子 agent 写策略由 `src/subagent-guard.ts` 承担，按会话血缘收缩子 agent 的写工具可见性，并在执行期拒绝其写调用；service 保留 fiber 生命周期、这些协作者的组合，以及该策略的刷新与释放；
- 配置提交校验与 volatile-update 监听由 `src/service-lifecycle.ts` 承担；ZoteroService 提供 live config 和重建 transport/tool 的回调；
- 请求驱动架构：插件加载过程不发起任何外部或本地网络请求。

### Provider 层 (`src/local/provider.ts`)

- `LocalApiProvider` 实现 `ZoteroProvider` 接口；
- 提供 search、metadata、attachments、citation、browse、retrieve、changes 等核心能力，写入能力仅在明确配置且授权就绪时提供；
- 搜索与浏览的作用域名称由插件基于缓存的列表数据自行解析；缓存列表由 scope directory 持有，并随传输层一同重建；`trash` 作用域（`/items/trash` 列表）是文献面板专属的搜索范围，模型工具的输入 schema 不提供它；
- Collection 与 saved search 的名称/层级解析由 `src/local/scope-directory.ts` 负责；全局 item types、fields 与 creator types 的实例隔离缓存由 `src/local/item-schema-directory.ts` 负责，browse 与写入共用同一个 schema directory；
- 读路径的并发由 `searchConcurrency`、`graphConcurrency` 两个限额约束，避免单次调用对本地 API 造成瞬时过载；
- 笔记内容扫描在第一页（offset 0）按限额执行；
- 查询参数编码由 `src/local/search-query.ts` 负责；路径片段由 `src/local/scope-paths.ts` 提供；
- 全文读取、coverage 解释和附件来源事实由 `src/local/retrieve-fulltext.ts` 负责；changes cursor 的 identity、coverage 和版本构造由 `src/local/changes-cursor.ts` 负责；
- Scope listing 规范化与名称匹配位于 `src/normalize-scope.ts`，saved-search 条件解码位于 `src/normalize-saved-search.ts`；search hit、item detail、child row 与共享上下文分别由 `src/normalize-search.ts`、`src/normalize-item-detail.ts`、`src/normalize-children.ts`、`src/normalize-context.ts` 承担；
- 原文片段经 `EvidenceRanker` 槽排序，核心默认使用 BM25，enrichment 可提供本地语义混合排序；
- 导出遵循 Zotero 本地接口的单次请求限制：除 `citation` 外的五种格式都在单次请求内取回全部条目（`itemKey` 单次上限 50 条），超出直接拒绝；`ris`/`csljson` 只需该次批请求，`bibtex`/`biblatex` 另外并行发出一次元数据批请求，用于把导出结果对齐到各条目；`citation` 按 50 一组发出多个请求；合并正文的逐条文档定位只服务于工具结果，面板端点只取渲染文本/引文；
- 写入领域支持跨库文献关系（`dc:relation`），群组库条目自动映射至规范的 `http://zotero.org/groups/<id>/items/<key>` URI；
- 非幂等写入的提交证明、拒绝映射及 `committed-unverified` 结果由 `src/local/write-verdicts.ts` 集中负责；操作域只负责构造请求和解释已验证回执；
- Saved search、Collection、tag/collection membership、note、批量写入、回收站恢复与全库标签删除分别由 `src/local/write-saved-searches.ts`、`write-collections.ts`、`write-item-lists.ts`、`write-notes.ts`、`write-batch.ts`、`write-library-maintenance.ts` 承担，复用以 `write-domain.ts` 为中心的版本化写入原语。

### 后台任务引擎 (`src/job-runner.ts`)

- 深度集成 Harness `ctx.jobs` 任务子系统；
- 支持显式后台执行（`run_in_background: true`）与前台等待超时自动提升（`promoteOnTimeout: true`，受 `foregroundWaitMs` 控制）；
- 信号分离：后台任务拥有独立的 `AbortController`，调用方轮次超时或取消时，已发布的后台任务继续运行；
- 通道隔离：流式进度通过 `{ channel: 'log' }` 向 Web 顶栏与日志流汇报，不污染模型上下文；完成后结果写入 `JobOutcome.result`；
- 按需启动与释放，不运行常驻轮询守护进程。

### HTTP 传输层 (`src/http-client.ts`)

- 仅支持环回地址 HTTP 请求，固定 API 版本为 3；
- 通过 `Zotero-Server-ID` 请求头校验实例身份一致性；
- 强制限制流式响应读取大小（`maxResponseBytes`）；
- 全局在途请求上限（`maxInFlightRequests`，默认 8），统一管理所有工具调用的并发槽位；
- 严格禁止重定向，无持久长连接；
- 超时由融合后的 deadline 与调用方取消信号共同管理。

### 原文片段检索管线 (`src/evidence.ts`)

- 分词采用 `Intl.Segmenter`（支持 CJK），词元经与 Zotero 保持一致的 `normalizeForSearch` 规则折叠；折叠只作用于匹配侧，原文原样输出；
- BM25 参数为 k1=1.2, b=0.75；词频统计以条目内部片段集合为语料基准，不跨条目统计；
- 查询侧单独归一：英中功能词不参与计分、重复词项只计一次，避免自然语言提问里的虚词产生伪证据；折叠索引与段落文本都不改写，也不按段落覆盖率把词项权重归零（全篇讨论同一术语时该术语仍是有效查询词）；
- `Intl.Segmenter` 只解决无空格语言的切分，功能词过滤也只解决虚词噪声，二者都不改变「按词项重合排序」这一性质；
- 词面路线排除零分段落：与查询没有任何词项重合的段落不计入该路线结果。
- 排序策略经 `src/local/evidence-ranker.ts` 的 `EvidenceRanker` 槽注入：核心自带完整词面 BM25 排序器；enrichment 组件挂载且开启语义检索时换装混合排序器（词面 + 本地语义向量，RRF 融合，不调用 MinerU）。本地 retrieve 与 `scholarly_read` 的 query 路径都在来源 I/O 前接纳可释放的 ranking scope，固定整次读取的配置、模型目标与服务世代，并在读取结束后释放；尚未开始排序的请求在组件卸载后仍可按固定目标懒加载。结果携带 `rankedRoutes`，空结果只描述实际执行过的路线；`matchKind` 标明命中路线，RRF 分数仅用于排序。
- `scholarly_search` 的主题路由不是语义路由：`src/scholarly/router.ts` 用两组正则短语表，`routeQuery()` 按短语命中分支选择数据源。

## 学术文献子系统 (`src/scholarly/`)

`dsh-zotero/scholarly` 是独立 bundle 组件，随包发布但默认禁用。组件是否挂载就是唯一授权：挂载即注册 7 个模型工具与自己的提示词段，并允许向显式允许列表中的外部索引发请求；未挂载时服务、传输层与工具都不存在。客户端在组件首次启用时显示外部检索提醒，说明检索涉及的目标主机范围。

- 授权与提示词同源：策略提示词由该组件自己注册（`src/scholarly/prompt.ts`，段落名 `scholarly:policy`），随组件挂载出现、随卸载消失；段落只列出该步骤准入的工具，准入为空时不渲染；web_fetch 路由禁令随任一外部 scholarly 工具保留；父组件的策略段不描述外部检索工具，只在 save 进入本步准入时按其名字归类写面。
- 主机白名单：`src/scholarly/transport/hosts.ts` 是唯一真源，允许的 host 与每主机限流间隔都从 `SCHOLARLY_HOSTS` 派生。
- 地址安全：白名单只判「名字」。端口仅允许 80/443（显式拼写等同默认端口）；开放获取 PDF 臂（`allowPublicPdf`）离开白名单时还须过第二道门——`src/transport/network.ts` 解析主机名并拒绝任何非公网单播地址（含 NAT64/IPv4-mapped 内嵌地址的判定），随后把已验证地址钉进 undici 连接（`connections.ts`），防止检查与建连之间的 DNS rebinding；重定向的每一跳都重新过词法门与解析门。第二道门有一个记录在案的 fake-IP 例外：本机解析器返回 `198.18.0.0/15` 占位地址时，已审阅的允许列表主机可以接受；开放获取 PDF 臂只对 HTTPS 目标接受；MinerU 传输同样只对 HTTPS 目标接受（MinerU 的全部地址都是 HTTPS，Token 仍只发往 `mineru.net`），身份由 TLS 证书绑定；明文 HTTP 目标、URL PDF 阅读、明文 HTTP 的 MinerU 目标与模型下载仍要求真实公网地址。允许列表臂只允许 HTTPS。dispatcher 只交给同一份 undici 副本的 `publicFetch`（`connections.ts`）；运行时全局 `fetch` 自带另一份 undici，会在建连前拒绝该 dispatcher，因此外部出口从不用全局 fetch。未接入这两道门（`publicAccess` 缺失）时该臂直接报错，不降级为不钉扎连接。
- 传输层：截止时间用 `@deepseek-ai/dsh-timeout` 的 `deadline()` / `timeoutOf()`，区分“provider 超时”与“调用方取消”（后者不重试）；响应体上限用共享的 `src/transport-bounds.ts`；在飞请求数由 `ConcurrencyGate` 约束，重试退避发生在闸门之外，不占用在飞槽位；熔断与限流按裸 hostname（不含端口）计。
- 凭证：学术检索配置只保存 `role('credential-ref')` 声明的凭据引用名（`s2ApiKeyEnv`、`ncbiApiKeyEnv`、`openalexApiKeyEnv`），密钥值不进入配置；`src/scholarly/credentials.ts` 在每次外部工具调用前经 `ctx.get('credentials')` 解析，引用名非法、凭据服务缺失或引用无值时分别报 `ZOTERO_SCHOLARLY_CREDENTIAL_UNRESOLVED` 或 `ZOTERO_SCHOLARLY_CREDENTIALS_UNAVAILABLE`，不静默降级为匿名请求。解析后的 key 中，Semantic Scholar 与 OpenAlex 走请求头；NCBI E-utilities 只接受 query 参数，该密钥经 URL 传递，错误消息只报 hostname，不内插完整 URL。
- 全文缓存：`src/scholarly/fulltext/store.ts` 在 `dshCachePath('zotero-scholarly')` 下按 key 存一份 JSON 正文，内存只保留 8 条索引；读结果分 `hit` / `miss` / `corrupt` 三态，损坏条目被驱逐并记录。
- 失败语义：全文解析的每条路由各自记录失败原因，终态错误逐条列出；失败原因会带上底层传输 code（如 `UND_ERR_INVALID_ARG`、`ECONNRESET`），本地 dispatcher 错配与安全拒绝不重试、不计熔断，安全拒绝的原始消息（含 fake-IP 提示）直接透出；`scholarly_verify` 用四值结论区分“注册表说没有”与“注册表联系不上”。
- 后台任务：`scholarly_read` / `scholarly_search` / `scholarly_verify` 复用核心的 `ZoteroJobRunner`（`src/job-runner.ts`），作业 kind 为 `scholarly`，输出上限 256 KiB；显式后台由 `run_in_background` 请求，前台超时按 `enableRunInBackground` / `promoteOnTimeout` / `foregroundWaitMs` 提升；组件卸载时 `ZoteroJobRunner.killAll` 终止本组件启动的作业。
- 公开面：`src/scholarly/index.ts` 只导出服务类、配置 schema 与领域类型；传输、主机表、存储与融合内部实现均不导出。

## 文档解析子系统 (`src/enrichment/`)

`dsh-zotero/enrichment` 是独立 bundle 组件，随包发布，默认禁用。启用组件即开通 MinerU 解析与本地语义模型管理功能；每次上传由用户针对具体文档提交并通过会话访问门禁，组件首次启用时客户端会显示外发提醒。

### 只读产物接缝

核心 `ZoteroService` 保留两个来自 `src/local/` 的纯接口槽。`FulltextEnhancer`（`fulltext-enhancer.ts`）只暴露 `lookup`，不表达 `enhance`、原始文档字节或上传操作；`EvidenceRanker`（`evidence-ranker.ts`）在空槽时使用核心完整的 BM25 排序器。组件经 `ctx.inject(['zotero'])` 装入并在卸载时撤槽，依赖方向始终是 enrichment → core。MinerU 传输、主机表、凭据、产物存储、源索引、嵌入运行时与模型下载均归 enrichment 所有。

`zotero_retrieve` 的 `best`、`specified`、`allIndexed` PDF 路径与 `scholarly_read` 的 PDF 分支只查询同一来源、仍有效的 Markdown。命中时优先使用，包括有效短文档；正常未命中时，本地读取 Zotero `/fulltext`，学术读取沿已有授权下载 PDF 后执行 `extractPdfText()`。摘要、笔记和批注保持各自来源。已有且有效的产物始终可读取。不存在或源戳变化属于正常未命中；权限、I/O、协议损坏等故障须明确报告，不能吞成未命中。

`lookup` 先查源索引，没有候选产物就不额外探测源；有候选时可 stat 本地附件，或至多发一次不带 token 的 HEAD 校验 URL。它不下载文档、不联系 MinerU，也不创建或恢复解析任务。无法证实有效时不提供过期 Markdown、不隐式重解析。普通读取、PDF 打开、设置保存和服务启动均受此约束。

### 主动解析与任务生命周期

主动解析目标采用闭合联合 `{kind:'attachment',ref}` 或 `{kind:'url',url}`，分别覆盖子附件、顶层 PDF 附件及具体公开 PDF URL；拒绝主机路径、会话文件、原始字节和未知字段。请求携带会话与每次用户操作的幂等标识，解析模式固定为已提交配置快照。宿主校验附件 ref、实例、库和 PDF 类型；公开 URL 逐跳经过公网地址、DNS 固定连接、端口、重定向、字节与 PDF 文件头校验。

界面在提交前展示解析目标与所选模式，用户确认后调用 enrichment 提供的端点执行解析。解析失败时直接返回错误信息。

`documentArtifact` 既是产物探测也是唯一的内容读取口：不带 `read` 时只返回元数据，详情据此判断该条目是否已有解析结果，并把「解析此 PDF」按钮切成「查看解析结果」；带 `read.offset` 时返回该偏移处一页有界 Markdown（上限 `ZOTERO_ARTIFACT_PAGE_CHARS`）与总字符数。条目带多个 PDF 时，详情对每个 PDF 各探测一次，选择框据此标出哪个已有产物；阅读面始终绑定最后选中的那个附件。读取沿用与探测相同的会话、远程动作与 PDF 类型门禁，只读、用户驱动、不轮询，只返回文本，绝不返回主机路径或签名 URL；阅读面按页续读，完整正文读齐后才允许复制和下载。

设计使用真实 `ctx.jobs` 承载会话所属解析作业，不填写 `JobSpec.toolCall`，不伪造模型工具调用。作业启动后由宿主的 `EnrichmentParseJobs` 以重叠续挂持有 `wait`（后继 waiter 在当前 waiter 到期前挂上），结算因此被记为 `awaited`，harness 的完成通知不会唤醒空闲模型；该机制不假设 job 生命周期有固定上界（排队、来源传输与解析都计入），结算记录仍保留给面板读取回执。通过 session controller 解析获准的活 Agent，允许空闲会话；缺 jobs、controller 或 Agent 时明确拒绝。前端计划复用 job-controller 的 `watchRows/observe/kill` 观察获取源、上传、等待、结果下载、校验与落盘阶段，不自建常驻轮询器。幂等标识防止 RPC 重放；同源、同模式、同代任务共享解析，各会话只可读取或取消自己的任务。回执包含目标身份、代次、模式、缓存或新产物、fingerprint、artifact revision、实际可得页数、字符数与有界预览，不泄露主机路径、签名 URL、token 或正文日志。

任务取消须同步、幂等发出中止，`done` 只在真实清理完成后落定。关闭界面只释放观察；明确取消、会话关闭或卸载撤销对应等待者，最后一个等待者离开才中止共享 `ParseFlight`。卸载停止接纳、杀死组件自己的解析作业与下载任务并等待清理。重新解析使用新 generation，保留上一份有效产物，完整写入新产物后才原子切换源指针；失败或取消不删除上一份有效产物。只有主动重试可恢复未完成任务，普通读取不能恢复。

### 前台读取与模型资源

本地 retrieve 与 `scholarly_read` 的 query 路径在任何来源 I/O 前同步接纳可释放的 ranking scope，固定已提交配置、模型目标与服务世代，整次读取在 `finally` 释放。接纳时不提前加载模型；尚未开始排序的请求在组件卸载后仍可按固定目标懒加载，并遵守原请求 deadline。模型切换只在新模型加载成功后提交；新模型失败向其请求报错，旧实例仍被管理，不能代答新目标。旧实例要等最后一个 scope 与实际推理结束才释放。

卸载立即撤槽并禁止新接纳，允许已接纳的前台作用域排空，等待实际 load/run 结束后一次性释放；重新注入使用新世代。组件自有后台解析与下载按上一节中止和清理。

### 现有传输与产物存储

`src/enrichment/transport.ts` 自建请求路径，复用 `src/transport/` 的公网地址词法门、DNS 解析与固定连接、逐跳重定向重校验与有界读取；API 返回的签名上传、结果 CDN 与缓存 HEAD 地址均视为不可信输入。`Authorization` 只发往固定的 `mineru.net` API 主机，签名上传、结果下载与源 HEAD 不携带凭据。签名上传不附加任何 header；非 2xx 正文有界截断并去 URL。阶段时限包括 30 分钟总预算、900 次轮询、提交/轮询 60 秒、上传 20 分钟、结果下载 10 分钟、源传输 20 分钟与 HEAD 15 秒。

`mode`（`free` / `pro`）独立选择接口；`free` 不解析 token。`pro` 引用无法解析时以 `ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED` 明确失败，不降级免费或匿名；已有缓存产物无需 token 即可读取。pro 的空 `extract_result` 视为 pending，末次轮询后不再额外等待。

当前产物在 `<outputDir>/<sha256>/` 下存 `full.md`、`meta.json`（精准模式另有 `content_list.json`），`meta.json` 最后写入作为提交标记。当前源索引 `<outputDir>/sources/index.json` 按 canonical source 的 SHA-256 记录最近一次产物与源戳（`mode` 在 artifact meta 与内容缓存键中），本地附件用 stat、URL 用 HEAD 比较 ETag/Last-Modified/Content-Length。原始 URL 的 query/fragment 不写入 `meta.json`。`output-dir.ts` 使用 realpath 校验系统根、home、`~/.ssh`、`~/.gnupg`（含 macOS `/private/etc`、`/private/var`），配置错误明确失败；`zip.ts` 限制总条目 4096、wanted 2，拒绝重复 wanted、越界名和超大条目，图片跳过不落盘。

### 本地语义排序与模型资产

本地语义排序与 MinerU 解析是独立能力：排序消费已有文本和本地模型，不联系 MinerU、不需要解析凭据；主动解析也不依赖模型。关闭 `enableSemanticSearch` 使用完整 BM25；开启但模型缺失、损坏或运行时不可用时，读取以 `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE` 明确失败，不静默改为词面结果。模型下载失败使用 `ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED`。

`src/enrichment-model-catalog.ts` 是浏览器与宿主共用的纯目录，钉死六个档位的物理模型、revision、文件大小与 SHA-256、维度、窗口、许可及池化、归一化和指令前缀；构建侧的下载器直接导入该模块（Node 的类型剥离），不再保留镜像副本。默认资产目录为 `~/.dsh/models/<physicalKey>/`，可由 `semanticModelDir` 指定，经 `safe-directory.ts` 校验。下载按 revision 逐跳经过公网双门，并有长度、流式字节、SHA-256、60 秒停滞及单文件 30 分钟限制；`manifest.json` 最后落盘。`ModelDownloadManager` 每服务一份，卸载会调用其取消逻辑；host 下载不支持代理，CLI 支持 `--proxy`。

`src/enrichment/semantic/` 按 tokenizer → onnxruntime-web（WASM、Node）→ 池化 → L2 归一化产出向量，加载前 `semantic/bundle.ts` 核对 manifest 与逐文件 SHA-256。准入按 `semantic/model-profiles.ts` 中每档实测固化的 `floor`（绝对余弦门槛）与 `margin`（相对最高余弦的容差）判定：`floor` 高于该档无关语料的最强余弦，因此全无关的非空语料不会产生语义命中；同一排序内按文本去重，跨请求共享有界向量缓存（`lru-cache`，最多 16,384 项 / 64 MiB）。六档模型均已用真实 ONNX 推理实测：在零实词重合的改写集上语义 recall@4 为 58–96%，无关语料语义命中 0%。`matchKind` 说明命中路线，RRF 分数只表示排序。

## 文献库子组件 (`src/library/`)

- 服务：`ZoteroLibraryService`（派生自 `TypertRemoteService`）注册 `ctx.zoteroLibrary`，独占 `library` 设置命名空间；端点 `browse`、`collectionPath`、`search`、`item`、`childPage`、`export`、`write`、`readUrlPdf`、`releaseUrlPdf`。本地库只读端点经 `requireZoteroService` 转交核心；写入经 `executeLibraryWrite` 进入标准写入审批链；
- 配置：`src/library/config.ts` 的 `LibraryConfigSchema` 定义 11 个 volatile 字段。`library-preferences.ts` 是纯共享取值与默认值权威；宿主逐次校验并执行 URL PDF 授权，浏览器消费已提交快照驱动外观与动作；
- 页面大小：面板请求的 `limit` 由宿主钳制到核心的 `maxBrowseResults` / `maxSearchResults`，响应回显实际生效值；
- 导出端点：`export` 复用核心的导出文本域（同一格式、同一 `defaultStyle`/`defaultLocale` 默认值、同一 `maxExportRefs` 上限；只返回渲染文本/引文，不做工具侧的逐条文档定位），供面板动作行复制引用；它是只读端点，不经过写入审批；
- 导出面：`package.json` 公开 `./library`、`./library/locale/*.json` 与 `./library/icon`，与根导出相互独立。

## 浏览器客户端 (`src/client/`)

客户端一份产物（`lib/client.js`）包含全部界面。所有表面在挂载 `remote.zotero` 之后注册；文献面板及其配置行额外受 `whileServed('library')` 守卫：`library` 行未组合时不注册任何面板表面，也不发起 `zotero/browse|collectionPath|search|item|childPage|export|write` 调用。

### 会话文献轨迹（`conversation.view`，id `zotero`，order 30）

- 数据来源：优先读取宿主会话投影 `zoteroSources`（`src/session-projection/source-ledger.ts`），它按整份会话日志折叠，不受浏览器历史窗口限制；状态端点等待投影注册完成并报告 `not-composed`、`pending`、`ready` 或 `failed`。只有 registry 未组合时才回退到 `ChatSnapshot` 的已加载窗口；注册失败时明确显示投影不可用，不将局部窗口伪装成完整轨迹。两条可用路径共用 `src/sources/ledger.ts` 的同一个归约器，把 `zotero_*` 调用折叠为按条目聚合的 `SourceWorkspace`。折叠是增量的：服务持有按会话状态链推进的索引，一次视图只冻结本轮改动过的条目，注册卸载时释放全部缓存，模块级 memo 不再存在；状态保持完整，投递给浏览器的视图按窗口截断（会话顺序的列表头），并携带在截断前算好的精确聚合——过滤器计数、段落总数、导出去重数与每个列表的精确 total——因此未列出的部分被如实计数，不会丢失。运行中、失败、已停止的调用只计入 `operations`，不进入成果；只有成功且结构合法的调用产生事实。
- 窗口后的翻页：被窗口截断的列表由核心的 `sourcePage` 端点（`src/source-page.ts`，挂在核心 `ZoteroRuntime` 上，不依赖可选的文献面板组件）按页补齐。请求携带会话 id、目标列表、偏移与可选 `currentServerId`；续页必须携带上次返回的 `revision`（会话水位线），轨迹变动时以 `ZOTERO_SOURCE_PAGE_STALE` 拒绝而不是静默续在另一份折叠上。每次调用先在宿主 `ctx.remoteAccess` 校验会话授权、折叠完整账本、再切出有界页并二次校验授权与会话仍打开。浏览器侧 `useSourcePage` 按需追加页：列表未超出窗口时不发请求，列表身份（会话、目标、实例、偏移）变化时弃用已收页并中止在途请求。
- 实例判定：归约状态保存条目 ref 的 `serverIds`；宿主编译时不知道当前连接的 Server ID，由客户端用状态探针结果调用 `withEvidenceMatch` 物化 `evidenceMatch`。
- 检索折叠：分页续调用按 identity 折叠为一次检索；首屏的 `total` 与 `noteMatches` 取第一次调用，`returned`/`omitted` 在续页累加。
- 界面结构：顶部透镜栏在“文献”与“导出”两个视图间切换；条目检查器包含概览、相关片段、导出三个面板；会话级导出页按格式分段并跨条目去重。
- 门控：`webEnabled` 为 false 时整页隐藏，开关热更新；首个快照到达前保持显示。
- 只读：不提供写控件；「提问」「导出引用」等动作只预填会话草稿，从不自动提交。

### 文献面板（`sidebarRightTabs` + `sidebar.right.pane.tab`）

- 门控：组件行已组合且面板 `rightSidebarEnabled` 开启才挂载；核心 `webEnabled` 只控制文献轨迹；开关变化即时生效。
- 数据面：`useLibraryFeed` 持有面板的全部 wire 调用；`library-data-plane.ts` 对其做同请求合并与短 TTL 缓存（browse 30s、item 10s、export 10s、search/childPage 2s，`collectionPath` 不缓存；最多 128 条），并按 `serverId` 重新键入缓存；只缓存成功读取，写入不经过该层。
- 访问门禁：面板整组（标签页类型、主体、标题、标签菜单、输入框按钮、交付与文档操作）只在宿主授予全局 `zotero/browse` 动作时注册；引文导出、附件定位与桌面端唤起各自回答自己的全局授权；写入抽屉回答会话级 `zotero/write` 授权，无授权时直接说明拒绝，而不是提供一个宿主必然拒绝的提交。宿主侧的检查（`src/library-write.ts` 的 `ctx.remoteAccess.allows`）仍是权威。
- 会话绑定：面板标签页是会话作用域：本地附件在该会话的右侧阅读栏打开，写入审批与计划卡发往该会话。
- 状态与无障碍：共享偏好来自 `ConfigForm` 的已接受快照，草稿只驱动设置页预览；浏览位置按 `serverId` 与会话存入 `localStorage`；详情载荷与探针快照按会话保存在内存中（上限 8 个会话）；合集树使用 ARIA tree、roving tabindex 与方向键。
- 布局：宽屏三列由匿名容器查询 `@container (min-width: 720px)` 切换；窄屏为分段导航（导航 / 列表 / 详情），并有 640/520/460/360px 的细化。
- 竞态：合集树由 `useLibraryNavigation` 的实例世代、每前缀库版本与在途去重负责，其它 lane 的旧结果不会混入；列表、检查器与子列表各自使用独立序号，晚到的旧响应按序号丢弃；子集合翻页走独立 `childPage` 端点。
- 请求纪律：探针返回前不发出任何面板请求；离线段不发请求；关闭面板后不再发起新请求。
- 写入口：`writeEnabled` 且选中个人库时显示；仅当所属会话正在运行时才能提交。
- 引用复制：动作行经 `zotero/export` 端点复制 CSL 引用、BibTeX 等格式，面板只取与 `zotero_export` 同源的渲染文本/引文（不含工具侧的逐条文档定位）；失败就地展示错误，不自动重试。

### 工具卡片

- 工具卡片（`tool.call.toolview`）：23 个本地模型工具与 `scholarly_save_to_zotero` 各有一张紧凑折叠卡片，其余 6 个学术检索工具按官方契约落通用行。卡片只渲染工具已有的输出，自身不调用工具，并对值得复制的取值提供复制按钮；「阅读 PDF」在右侧边栏打开原文。
- 参数读取与错误边界：卡片与轨迹归约器统一通过 `argsViewOf(block)` 读取 `block.args`；`ZoteroSurfaceBoundary` 包裹文献轨迹页，`ZoteroCardBoundary` 包裹全部工具卡片，渲染异常就地降级，不向上逃逸。

### 设置与插件管理表面

- `plugins.bundle.config` 在插件详情页承载统一的 7 标签页配置表单（基础设置、本地连接、检索提取、文献面板、学术检索、文档解析、高级选项），管理 `zotero`、`library`、`scholarly`、`enrichment` 四个命名空间，保留未提交草稿；
- `plugins.row.config` 为 `dsh-zotero#library`、`dsh-zotero#scholarly` 与 `dsh-zotero#enrichment` 提供组件行配置；
- `plugins.bundle.activation` 在启用插件时弹出连通性引导；`plugins.detail.section` 提供实时状态卡与诊断卡；
- 文献轨迹的写回执、导出元数据与同步 diff/job 分别由 `write-decoder.ts`、`export-decoder.ts`、`sync-decoder.ts` 解码，其余工具结果由 `decoders.ts` 解码。

### 统一右键菜单与文献交互（`contextMenus`）

- 工作区文件（`dsh-zotero.file`，order 150）：目标为文献引用文件（`.bib`、`.ris`、`.csljson`、`.csl.json`、`.biblatex`、`.bibtex`）时，提供「在 Zotero 文献库中查看」操作；该菜单只在文献库面板挂载时注册，点击用 target 捕获的 session 打开 `zotero-library` 页；
- 文献条目（`dsh-zotero.item`，order 100）：为 `zoteroItem` 目标提供「在 Zotero 中打开」与「复制链接」操作；启动失败会向菜单返回失败提示，剪贴板拒绝会显示不可用提示。

### 文档预览动作（`sidebar.right.tab.document.actions` / `.unpreviewable`）

- 预览工具栏扩展：针对 preview 中的文献引用文件（`.bib`、`.ris`、`.csljson`、`.csl.json`、`.biblatex`、`.bibtex`），在右侧头部动作行中提供直达 Zotero 文献库面板的快捷按钮；
- 不可预览状态扩展：当文献引用文件不可直接内联预览时，提供同一入口。

## 远程通信与设置

- 宿主半侧通过三个 Typert 服务在 `zotero` wire 命名空间下注册端点。`ZoteroRuntime`（`zoteroRemote`）负责 `status`、`resolveAttachment`、`diagnostics`、`reportClientError`、`openProtocol`、`revokeWriteGrant`、`sourcePage`；`ZoteroLibraryService`（`zoteroLibrary`）负责 `browse`、`collectionPath`、`search`、`item`、`childPage`、`export`、`write`、`readUrlPdf`、`releaseUrlPdf`；`EnrichmentService`（`enrichment`）负责主动解析、产物回执与语义模型管理：`startDocumentParse`、`documentArtifact`、`documentParseReceipt`、`semanticModelStatus`、`downloadSemanticModel`、`cancelSemanticModelDownload`、`deleteSemanticModel`、`verifySemanticModel`。接收方是组件自己的 Cordis 服务，组件行卸载时网关按 `gateway/service-unavailable` 应答；
- enrichment 远程边界统一经 `errors.ts` 的 `domainCall` 保留领域错误码，并区分取消与 Gateway 错误。只有确切的 `gateway/service-unavailable` 表示组件缺席；权限、连接、目录或协议失败会报告实际原因，不改写成组件不可用；
- 浏览器半侧通过 `ctx.remote.$mount` 挂载命名空间，配置读写走 `zotero`、`library`、`scholarly`、`enrichment` 四个命名空间的共享设置表单；
- 文献面板设置同时提供 11 项 `library` 偏好和 2 项核心 CSL 默认值的直接编辑；`CitationFormController` 为后两项持有独立暂存模型，两个入口共用该模型，不会提交连接等其他字段的草稿。`tests/client/settings/citation-defaults.spec.tsx` 验证真实表单组合、保存拒绝与入口一致性；`tests/client/cards/zotero-card-parity.spec.ts` 验证两个核心字段表合并后与宿主 schema 完整对应；打包后浏览器验收由 `smoke:web-composition` 验证保存和刷新持久化。
- 配置全字段声明为 volatile，支持热重载；
- `openProtocol` 协议唤醒：WSL 与 Windows 环境统一采用 `powershell.exe` 调用宿主系统默认程序唤醒 `zotero://` 链接；host 端点失败时抛 `zotero/protocol-failed`，浏览器半侧通过 `shell.overlay` 的 toast 与诊断上报呈现失败，不再保留 DOM anchor 回退。

## 诊断与日志

插件维护容量 500 条的进程内诊断环形缓冲（`src/diagnostics.ts`），集中记录运行时错误、功能降级与渲染崩溃：

- 记录来源：HTTP 请求、工具调用、Job 状态、配置变更、写门禁、Shell 拦截、连接探测与降级事件通过 `DiagnosticSink` 写入结构化条目；服务挂载随 fiber 生命周期的日志导出器，按名称前缀捕获插件子树的 `ctx.logger` 输出。
- 工具结果：进入分发的调用在结果发布时记录一条 `tool.result`，失败为 warn 并附带结果携带的稳定 `errorCode`，成功为 debug；`ms` 从进入 `tools/execute` 计到结果发布（含 post-execute 与终态化），未进入分发的拒绝或取消不含 `ms`。
- 保留级别：默认不显示诊断面板；开启「诊断」后额外记录请求行与调用摘要，连续相同条目合并并递增 `count`，消息与详情字段均有长度上限。
- 读取接口：`zotero/diagnostics` 端点按时间倒序返回快照（总数、截断标记、debug 开关）；前端诊断卡仅在开启诊断且面板可见时轮询。
- 前端异常上报：组件错误边界与 `ctx.slots.onEntryError` 监督通道覆盖两组不相交的崩溃，均写入同一环形缓冲；后者按注册时盖的 `registrant` 所有权戳过滤，只认本插件条目。
- 界面呈现：诊断卡支持级别过滤、最新条目与截断提示，并提供诊断包一键复制。
- 数据安全：记录仅保存在内存中，不落盘、不外发遥测；HTTP 记录只含方法、路径、状态码与耗时，响应体与文献正文不进入缓冲区。

## 设计边界

- 文献库权限：默认只读；开启 `writeEnabled` 后仅允许写入个人库（`zotero://user/0/`）；
- 网络边界：本地请求严格限制在环回地址（`127.0.0.1`、`localhost`、`::1`），拒绝重定向；外部学术检索由 scholarly 授权，用户主动的 URL PDF 阅读由文献面板独立授权。MinerU 请求只由用户针对具体目标主动提交的 enrichment 解析任务发起；本地语义不联系 MinerU，模型下载独立发起；
- 进程管理：无常驻轮询守护进程与遥测收集；核心、scholarly 与 enrichment 的长任务都由 `ctx.jobs` 承载。后台解析与下载在卸载时中止并等待清理，已接纳的前台读取作用域排空后释放；
- 段落排序：经 `EvidenceRanker` 槽执行——核心对条目自身片段语料做 BM25 词频匹配，enrichment 组件在其模型启用时换装词面+语义的混合排序器；
- 轨迹边界：文献轨迹只展示本会话读类工具与导出产生的事实，不记录写入，也不含库外文献；
- 范围边界：回收站是文献面板专有范围，模型工具 schema 不提供。

## 导航状态与路径端点

`useLibraryNavigation` 独立管理连续前缀、库版本、在途去重、最多四个导航任务以及恢复和定位；`useLibraryFeed` 管理条目与统一持久化。存储采用 v3 键与格式（按实例和会话隔离），仅保留状态与视图标记，不持久化目录响应或叶节点推断。只读端点 `collectionPath({ library, ref, libraryVersion })` 经 `ctx.zoteroLibrary` → `ctx.zotero` → Local Provider，使用 browse 能力门控。返回根至目标的真实合集行及库版本；结束时通过轻量列表读取校验版本，不使用单对象版本或名称缓存。祖先缺失、循环与非法父关系明确失败。合集和保存搜索分页必须携带有效 `Last-Modified-Version`，双端 codec 拒绝缺失版本。同一前缀的各页必须共享同一库版本；版本前进时只重启该前缀，其余分支与服务请求不受影响。路径数据面只合并同代在途请求，不复用已完成结果。

读取交付由 `result-delivery.ts` 统一管理：`zotero_results` 保存持久回执，AttachmentStore 保存单份完整 JSON。`result-route.ts` 按认证的持久事件坐标读取；八个读取工具共用 inline/file 结构，后台与超时提升的任务先持久化再完成（前台落定由 inline 预算决定），post-execute 为所属 job_output 追加有界标准 FileBlock。`result-reader.ts` 在校验流结束后才允许复制下载。按种类窗口和完整读取共用顺序 `childPages`，位置解析复用当前页并限制并发。

### 用户主动阅读 URL PDF

`src/library/service.ts` 在独立 `allowUrlPdfRead` 授权下从核心解析库内附件，`src/library/url-pdf.ts` 只按已解析的附件下载。`src/transport/` 由 scholarly 与用户阅读共用公网地址和 DNS 固定连接，不触发 scholarly 组合。下载检查逐跳重定向、HTTPS 降级、类型、文件头、32 MiB、60 秒和两并发；撤销授权取消在途请求。`pdf-files.ts` 持有私有临时文件的租约（最多 16 个）；客户端通过现有公开 `fileAddressFor` / `tab.actions.openResource` 打开原会话的阅读器，订阅 `sidebarRight.openTabs` 在最后一个阅读标签关闭时释放文件，插件卸载释放余下文件。保存设置及恢复标签不触发下载。实现无需修改宿主仓库。

设置与阅读验收分工：`tests/host/library/config-commit.spec.ts` 通过真实 Loader 验证原子配置提交与拒绝；`url-pdf.spec.ts` 验证网络安全、撤权及下载边界，`pdf-files.spec.ts` 验证文件权限和释放；客户端 `settings-acceptance.spec.tsx` 验证草稿隔离、确认和复制动作，`preference-runtime.spec.tsx` 验证标签生命周期、范围条件和插入内容，`pdf-reader-lifetime.spec.ts` 验证隐藏与浮动标签的清理归属。实时 Zotero 检查由 `npm run test:integration` 执行，打包浏览器组合由 `npm run smoke:web-composition` 执行；二者不能被模拟测试替代。

浏览器仅保留来源附件 ref，恢复的阅读标签通过显式重载重新下载并替换原标签，不保存临时下载 URL。

<p align="right"><a href="architecture.en.md"><b>English</b></a></p>

# 系统架构

本文按运行时关注点描述系统：组件拓扑、数据流、状态与一致性、并发与资源、安全边界、端侧契约、设计边界。每条不变量给出当前实现和验证位置。配置字段、工具参数、界面呈现分别由 `configuration.md`、`tools.md`、`features.md` 拥有；上游绕行补丁由 `development-notes.md` 拥有。本文按职责组织，不按源码目录罗列实现。

## 组件拓扑与生命周期

### 组件与依赖方向

| 组件                    | Cordis 键                                 | 设置命名空间 | 默认 | 职责                                 |
| ----------------------- | ----------------------------------------- | ------------ | ---- | ------------------------------------ |
| `dsh-zotero`            | `zotero`（wire 命名空间 `zotero`）        | `zotero`     | 启用 | 连接、模型工具、文献轨迹、设置页     |
| `dsh-zotero/library`    | `zoteroLibrary`（wire 命名空间 `zotero`） | `library`    | 启用 | 文献面板的宿主端点与右侧边栏界面     |
| `dsh-zotero/scholarly`  | `scholarly`                               | `scholarly`  | 关闭 | 外部学术索引检索与全文读取           |
| `dsh-zotero/enrichment` | `enrichment`                              | `enrichment` | 关闭 | 主动解析、产物查询与本地语义模型管理 |

核心持有数据面与 Agent 能力；library 把本地库端点转交核心；scholarly 是外部检索授权边界；enrichment 提供只读产物查询与主动解析。依赖方向固定为 library/scholarly/enrichment → core；core 只通过 `FulltextEnhancer` 与 `EvidenceRanker` 两个纯接口槽调用增强能力，不反向依赖 enrichment。`FulltextEnhancer` 只暴露只读的 `lookup` 与 `lookupArtifact`：前者按来源查有效 Markdown，后者按不透明 artifactId 解析本地产物；接口不表达 `enhance`、原始文档字节或上传操作。

### 挂载、配置与卸载

加载器把默认导出的 `ZoteroService` 与校验后的配置一同挂载；插件按请求访问网络，加载阶段不发起任何外部或本地请求。结构性配置变更在现有实例上重建 HTTP 客户端、Provider 与写工具集，触发条件是 `TRANSPORT_CONFIG_KEYS` 的六个键（`baseUrl`、`timeoutMs`、`maxResponseBytes`、`maxInFlightRequests`、`writeAuthorizeDeadlineMs`、`writeEnabled`）；其余限额由 Provider 实时读取，不触发重建。

组件卸载时撤槽、停止新准入、终止自己启动的解析与下载作业并等待清理；已接纳的前台读取作用域排空后释放。本地终端子进程使用上游 `scrubbedParentEnv()`：它在删减凭据形状与 `DSH_*` 之后补回宿主代理变量，使子进程与宿主使用同一网络路径；调用方显式传入的环境表按同一规则处理，但不补代理。

### 宿主契约适配

`ctx.zotero` 是核心服务边界；Typert 服务与 wire 端点见「端侧契约」。宿主契约中依赖具体 pin 的镜像、私有路由与控件适配不写进本节：它们属于 `development-notes.md` 的上游补丁，本条目不复制补丁的成因与退出条件。

## 数据流

### 本地读取

面板经 `ctx.zoteroLibrary` 调用 browse/collectionPath/search/item/childPage/export；`useLibraryFeed` 合并同请求并做短 TTL 缓存，按 `serverId` 重新键入，只缓存成功读取。模型工具经 Provider 读取搜索、条目、附件、批注、笔记与上下文；scope 名称与 item type 词汇由本地缓存目录解析；`trash` 只属于面板，模型工具 schema 不提供。

读并发由 `searchConcurrency` 与 `graphConcurrency` 约束；候选与附件扫描共享检索预算，预算为 1 时串行；批量 get 在传输容量允许时为交互读取保留一个槽位；笔记正文只在第一页扫描。导出的非 `citation` 格式单次取回全部条目（上限 50），`bibtex`/`biblatex` 另发一次元数据批请求，`citation` 按 50 分批；面板只取渲染文本/引文。

工具 schema 的 `default` 只是不参与验证的 JSON 注解，默认值由工具代码应用；互斥组合按参数是否存在校验（省略 retrieve mode 的契约是 evidence）。

原文检索用 BM25（k1=1.2、b=0.75）按条目内片段语料排序；查询侧去掉功能词与重复词项，零分段落不进入词面路线；`EvidenceRanker` 槽在 enrichment 模型启用时换装词面+语义混合排序器，RRF 只用于排序。`search-text.ts` 保持镜像 Zotero 的 `normalizeForSearch`；`includeTrashed` 不出现在检索工具 schema。

全文读取先查同源有效 Markdown；未命中时本地读取 Zotero `/fulltext`，学术读取沿已有授权下载 PDF 后抽取文本。`complete=true` 一次返回整篇有界文档或 spill 句柄；窗口链用 `nextStart`/`continuation` 无损续读，来源或代际变化拒绝续读。不存在或源戳变化是正常未命中；权限、I/O、协议损坏明确报告。

文献轨迹从会话事件增量折叠，按窗口交付列表头并携带截断前的精确聚合（过滤计数、段落总数、导出去重数、每个列表的精确 total）；窗口后的列表由核心 `sourcePage` 按页补齐，续页必须携带上次的 `revision`，轨迹变动以 `ZOTERO_SOURCE_PAGE_STALE` 拒绝。证据事实保留附件、匹配方式与匹配字段；只有成功且结构合法的调用产生事实。

### 本地写入

所有写入经 `ctx.zotero` 的统一接缝：能力门 → 只读预检 → `ctx.approval.request` → 计划审查卡 → Local API。Zotero 在鉴权时消耗一次性密钥，授权到发送完成期间独占；整次读改写周期含 15 分钟总时限，覆盖排队与授权。批量写最多 50 项，按依赖层先子后父；每项回执必须证明索引、身份、版本和全部提交字段，缺失或矛盾返回 `committed-unverified` 且不重试。

笔记比较 HTML 结构，只接受已核实的 Zotero 外层包装、控制字符清理与 HTML 解析等价形式；标签与集合按集合比较；个人库关系 URI 统一为本地身份。集合、笔记与合集归属在审批前用 `preflightWrite` 排除已知无效目标，审批后重新读取再写。计划卡的自由文本意见一律拒绝当前写入，即使同一答复选择 Apply。保存的检索在 PATCH 后重读并验证名称、全部条件与版本。

`src/shell-write-detector.ts` 在 `tools/pre-execute` 把可识别的 Local API 写命令提升为一次预运行审批；它只覆盖已识别的命令形状，运行期拼出的请求是已知盲区。

### 学术检索

组件是否挂载就是授权。索引检索只访问 `SCHOLARLY_HOSTS` 白名单；开放获取 PDF 臂离开白名单时还要过公网地址门。融合以强标识（正式 DOI、PMID、PMCID、arXiv ID）优先；无共享标识时，标题词集合完全相同、第一作者姓氏与名首字母一致、双方年份相差不超过一年才合并；版本关系合并为一条，主记录取正式版，版本元数据保留在 `ScholarlyPaper.versions`，撤稿只在同一记录内传播。

引用工具按请求格式解析正文并核对 DOI：CSL-JSON 需可解析、非空标题与匹配 DOI；BibTeX 需 `@type{...}` 结构与匹配 `doi`；RIS 需 `TY`/`ER`/`DO` 结构；`text` 拒绝空正文与明显 HTML 错误页。HTTP 2xx 不是引用有效性的证据。`scholarly_verify` 对裸 DOI 只核对标识符与撤稿状态，完整参考文献只比较实际提供的字段，未提供字段为 `not-compared`。

### 文档解析

解析目标只接受 `{kind:'attachment',ref}` 或 `{kind:'url',url}`：具体子附件、顶层 PDF 附件或公开 PDF URL；拒绝主机路径、会话文件、原始字节与未知字段。请求携带会话与每次用户操作的幂等标识，模式固定为已提交配置快照。用户确认后才调用 enrichment 端点；上传要求组件启用、具体目标、远端动作与会话检查。学术检索或 `allowUrlPdfRead` 的阅读授权不授予上传。

解析 job 用真实 `ctx.jobs` 承载，按来源、模式与代次共享 `ParseFlight`，各会话只能读取或取消自己的任务。取消同步、幂等发出中止，`done` 在真实清理后落定；关闭界面只释放观察；明确取消、会话关闭或卸载撤销等待者，最后一个等待者离开才中止共享解析。重新解析使用新 generation，完整写入新产物后才原子切换源指针；失败或取消不删除上一份有效产物。

解析回执包含目标身份、代次、模式、缓存或新产物、fingerprint、artifact revision、实际可得页数、字符数与有界预览；错误消息先去除 URL、路径与凭据，再限制为 256 字符。回执不泄露主机路径、签名 URL、token 或正文日志。会话操作回执与 generation 指针位于独立的 `$DSH_HOME/zotero-receipts/parse-jobs/`，不随产物目录变化；上传前后任务记录满 24 小时过期，轮询耗尽清除续挂记录。面板解析 job 的完成通知绕行见 `development-notes.md` 的 DN-1。

### 文献轨迹

轨迹只展示本会话读类工具与导出产生的事实，不记录写入或库外文献。投影状态版本为 3，只含分块 ledger；严格 schema 拒绝旧版本多余字段，宿主从事件重放构建。运行中、失败、已停止的调用只计入 `operations`，不进入成果；没有条目 ref 的检索另计入 `searchOperations`。检索 episode 按 identity 折叠；`evidenceMatch` 由客户端用状态探针物化。完整事件与正文由宿主保留，分页读取不截断正文。

## 状态、存储与一致性

### 解析产物

产物目录以 `<outputDir>/<sha256>/` 存放 `full.md`、`meta.json`（精准模式另有 `content_list.json`）与 Markdown 引用的 `images/`；`meta.json` 最后写入作为提交标记。源索引 `sources/index.json` 按 canonical source 的 SHA-256 记录最近产物与源戳。产物目录与源索引是两次独立写入，列表必须按 cacheKey 合并两个视图并去重，识别孤儿目录、悬空索引与损坏 meta。

删除必须先独占 generation、中止并等待所有相关解析实际结算，再清掉全部别名键、任务文件、该 generation 的解析收据与内存记录，并先失效绑定该产物的读租约；首个 orphan 尚未创建 `sources/` 时，删除仍须安全建立索引锁目录。完整 canonical URL 只在 host 磁盘与 `meta.json.sourceUrl` 中用于恢复孤儿 target，不进入 identity、回执、wire 结果或显示字段。

产物根必须是当前用户所有、组与其他用户不可写的 POSIX 目录；祖先须归当前用户或 root，或具有 sticky 保护，任何可被其他用户写入的祖先必须有 sticky 保护；新建目录 0700。提交元数据记录 Markdown、可选内容列表与全部图片的 SHA-256，每次读取验证摘要与字节/字符边界；缺少摘要的旧产物显式无效。Windows 不以 POSIX uid/mode 判定 ACL。

ZIP 先验证目录、local header、数据描述符与条目范围一致，再只解压被选择的文本与引用图片。deflate 的原生 `maxOutputLength` 限制实际输出；输出长度、消耗的压缩长度与 CRC 必须全部匹配；originalSize 仅作元数据。Worker 设置堆/栈限制与 30 秒截止，取消后等待退出再释放槽位；未引用条目仍计入目录与范围预算，不解压。

### 写代数与缓存

`ParsedArtifactStore` 按解析后的根目录记忆化（每个 root 单实例）；库存（目录枚举加每个 cacheKey 一次 `metaFor`）按写代数缓存。每次写尝试——包括失败的写——都先 `touch()` 递增代数并失效缓存；新增任何 store 写方法必须同样先 `touch()`。源索引按调用读取、不缓存，I/O 失败必须浮出。

SQLite 解析索引以 MinerU 已提交的 Markdown 为数据权威。每个解析输出目录在 `<outputDir>/index.db` 保存独立的 SQLite 数据库。FTS5 分区使用固定名称，可随目录迁移，通过 WAL 事务发布完整代次。解析提交和删除维护索引，库或合集检索会回填已有产物。候选在排名前按当前 Zotero 实例、有效来源与合集成员资格过滤，返回的偏移量以已校验的 Markdown 为准。受限范围使用独立的文档长度和词频统计，范围外产物不参与排名。单篇证据排序使用内存 BM25 和可选的本地 ONNX，解析索引负责跨文档候选召回。真实 SQLite 的代次、范围及原文区间由 `tests/host/enrichment-parsed-index.spec.ts` 验证。

`lookupArtifact` 按 `(artifactId, contentFingerprint, parseGeneration, store.writes)` 命中读穿缓存，未命中只读源索引与 `meta.json`。artifactId 指向本地产物，因此 URL 文档解析完成后可离线读取，本地附件删除也不使产物失效；条目 ref 的 `lookup` 仍做一次 stat/HEAD，因为读取的是 Zotero 索引文本。

### 结果交付与收据

超预算结果必须完整存入附件并返回有界收据；存储失败明确失败，后台任务不改完整正文或截断正文。收据按发布时间保留每会话最近 128 次、全局最近 1,024 次交付，call/job 双键共同淘汰；删除收据不删除宿主保留的会话历史文件。坏收据逐条备份隔离。

解析检索的出处引用保存在持久收据和会话呈现元数据中。模型侧附件公告按内联预算依次省略预览和出处列表，用 `detailOmitted` 标记。`tests/host/result-delivery.spec.ts` 核对同一结果的附件、收据、会话元数据和公告字节数。

浏览卡片保留最多 20 行完整前缀，并在 6 KiB 行预算内计入 JSON 分隔符；保留真实分页与返回计数，以 `omitted` 明示未展示行。写入在计划前与服务批准前检查标量，HTTP 编码前限制为 1 MiB，正文不截断。前台提升竞态只发布一次附件，未提升候选不把正文复制到 job outcome。卸载关闭新准入，最多等待 5 秒；已进入发布的工作保留域句柄直到结算。

### 轨迹持久状态

投影状态只保存参与折叠的事实；`stateVersion` 3 的严格 schema 拒绝旧版本多余字段，宿主从会话事件重放构建。继承事件与普通事件同样折叠。检索工具禁止 `includeTrashed`，轨迹 occurrence 不声明这项能力。生产读取只走增量 `SourceWorkspaceIndex`；测试通过实际投影读取，避免保留第二条全量重放实现。

### 外部缓存

学术全文缓存按 key 存 JSON 正文，内存保留 8 条索引；读结果分 `hit`/`miss`/`corrupt`，损坏条目被驱逐并记录。驱逐立即使内存条目失效；磁盘清理失败作为本次读取的问题返回；冷读只采纳未与写入或驱逐交错的快照，迟到的字节不能重新进入内存。

`include:["fulltext"]` 读取当前全文索引清单（`/fulltext?since=0`），返回各附件的全文索引版本；它不是从库事务游标计算的增量，不能据此判断附件何时重新索引。回收站降级推导只有两侧清单都完整时才给出条目，残缺输入不得当作删除证明。

## 并发、资源与隔离

传输层持有跨传输重建的全局在途请求闸门（`maxInFlightRequests`，默认 8）：缩容时已接纳请求先排空，扩容时按顺序释放等待者；响应读取受 `maxResponseBytes` 限制；超时由融合 deadline 与调用方取消信号共同管理。

文档读取用 `documentArtifact`：`open` 携带客户端 UUID `requestId`，绑定真实 peer、会话、原 Agent 与 open 时固定的 store，返回读取 lease、图片 manifest 与首块正文；`page`/`image` 按 lease 读取固定版本；`release` 按 requestId 幂等释放。正文块上限 65,536 字符；读取前与异步 I/O 后复核授权。源换代与目录切换不影响旧快照；browserPeer 可被浏览器连接共享，页面关闭由显式 release、一次性期限与资源预算共同兜底，不能只依赖 `peer.signal`。

ZIP 解包、引用分析与内容列表校验在独立 Worker 完成；父线程验证闭合消息，持久化只接收归一化负载；发布运行使用 `lib/enrichment/zip-worker.js`。归档准入的并发与队列上限实时取自配置的 `artifactReader`；`ParseFlight` 必须收到实时限额策略，用默认策略构造会让这两个配置静默失效。

本地语义：排名 scope 在任何来源 I/O 前 `admit()`，固定已提交配置、模型目标与服务世代，整次读取在 `finally` 释放；加载在该 scope 上立即开始，准入后的模型切换不会把这次读取换到另一份模型上。模型切换只在新模型加载成功后提交；旧实例等最后一个 scope 与实际推理结束再释放；常驻模型在 `semanticIdleTimeoutMs`（默认十分钟）无请求后回收。

每模型独立 worker：打开上限 180 秒，单次推理上限 120 秒；超时终止实际线程，等待退出后才允许后继模型打开；取消只结束调用方等待。worker 返回的向量逐批核对个数、Float32 类型、维度与有限值；终止的 resident 不再服务新 scope，新请求从磁盘重新打开。bundle 校验、tokenizer 与 ONNX session 归 worker 所有；manifest 单次有界读取（64 KiB），拒绝符号链接，逐文件 SHA-256。查询与改写每条最多 2,000 字符；嵌入文本连同前缀限制为 131,072 字符；含 padding 的批次按 32,768 token 拆分，保留全部行且每条只编码一次；每代向量缓存最多一个推理 batch 在途，跨请求最多 16,384 项 / 64 MiB。

确定性缺失或损坏的 bundle 最多缓存 16 个身份快照；复用前重新比较规范目录、catalog 指纹及目录、manifest、全部 pinned 文件的 identity（dev/ino/size/mtime/ctime 或缺失）。路径安全拒绝、I/O、运行时、取消和超时不缓存；排名失败不回退到词法结果。

## 安全与信任边界

本地 API 只支持环回地址（`127.0.0.1`、`localhost`、`::1`），固定 API 版本 3；`Zotero-Server-ID` 校验实例身份；严格禁止重定向；响应读取受 `maxResponseBytes` 限制。

外部出口按白名单判名，端口只允许 80/443（显式拼写等同默认端口）。离开白名单的开放获取 PDF 臂还要解析主机名并拒绝任何非公网单播地址（含 NAT64/IPv4-mapped 内嵌地址），把已验证地址钉进 undici 连接，逐跳重定向重新过词法门与解析门。fake-IP 例外只适用于已审阅白名单主机的 HTTPS 目标、HTTPS 公网 PDF 与 HTTPS MinerU；明文 HTTP、URL PDF 与模型下载仍要求真实公网地址。代理路由与地址钉住互斥，外部出口只用同一份 undici 的 `publicFetch`；绕行原因与退出条件见 `development-notes.md` 的 DN-13。

MinerU API 主机固定为 `mineru.net`，`Authorization` 只发往该主机；签名上传、结果 CDN 与缓存 HEAD 不携带凭据。签名上传不附加任何 header；非 2xx 正文有界截断并去 URL。阶段时限包括 30 分钟总预算、900 次轮询、提交/轮询 60 秒、上传 20 分钟、结果下载 10 分钟、源传输 20 分钟与 HEAD 15 秒；上传前后任务记录满 24 小时过期。

URL PDF 阅读由 `library.allowUrlPdfRead` 独立授权；下载检查逐跳重定向、HTTPS 降级、类型、PDF 文件头、32 MiB、60 秒与两并发；撤销授权取消在途请求。浏览器只保留来源附件 ref，恢复的阅读标签通过显式重载重新下载并替换原标签。

模型下载只允许固定种子主机、按 revision 的 URL、逐跳重校验、字节上限与 SHA-256 校验；host 路径不支持代理，CLI 支持 `--proxy`。解析页远端图片在显示前转换为普通链接，只有产物携带的本地图片经受控 Blob URL 显示；代码块中的示例不改；上游 renderer 先接受远端图片再调用 pathImages，因此拒绝策略在本地语法树阶段完成。

凭据：学术检索与 MinerU token 都是 `ctx.credentials` 的引用，每次调用解析；引用无效、服务缺失、值为空或含非法字符时 fail closed（`ZOTERO_SCHOLARLY_CREDENTIAL_UNRESOLVED`、`ZOTERO_SCHOLARLY_CREDENTIALS_UNAVAILABLE`、`ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED`），不降级为匿名或免费。上游 `resolveCredentialRef` 在未挂载 credentials 服务时会回落到启动环境，本仓库因此保留本地按调用解析装配，服务缺失仍是失败。Zotero 写授权存于 `dsh-credentials`，不进入插件配置。

## 端侧契约与界面表面

宿主半侧通过三个 Typert 服务在 `zotero` wire 命名空间注册端点。`ZoteroRuntime` 负责 `status`、`resolveAttachment`、`diagnostics`、`reportClientError`、`openProtocol`、`revokeWriteGrant`、`sourcePage`；`ZoteroLibraryService` 负责 `browse`、`collectionPath`、`search`、`item`、`childPage`、`export`、`write`、`readUrlPdf`、`releaseUrlPdf`、`journalMetrics`；`EnrichmentService` 负责主动解析、产物回执、已解析文档管理与语义模型管理。`domainCall` 保留领域错误码并区分取消与 Gateway 错误；只有确切的 `gateway/service-unavailable` 表示组件缺席。

期刊指标使用文献面板独立的远程读取。面板加载 Zotero 条目后，在有列表候选时按当前页条目的刊名去重并查询。配置了详情指标时，选中条目的查询独立发起，并具有更高优先级。宿主在独立授权开启时解析凭据，合并同一刊名的在途查询，请求启动间隔至少 500 毫秒，并遵守 EasyScholar 的 Retry-After 等待时间。成功结果以密钥与规范刊名的组合摘要为索引，原子写入宿主缓存，最多保留 512 条。记录保存规范刊名、指标和查询时间。六小时内复用结果。设置中的 `refreshJournalMetrics` 使用相同队列更新当前密钥保存的所有期刊，汇报成功数与失败原因。刷新失败时保留已有记录。最后一个调用方取消等待时中止查询；撤销授权或更换凭据会使内存代次失效。查询只向固定 HTTPS 端点发送期刊名与密钥，不跟随重定向。跨重启复用、密钥隔离和刷新失败的回退由 `tests/host/library/journal-metrics-cache.spec.ts` 验证。

宿主以 `officialRank.all` 为准，并用 `officialRank.select` 补齐缺少的指标。`customRank` 为 `null` 时视为没有自定义评级。EasyScholar 的成功响应可能将 `officialRank.all` 和 `officialRank.select` 同时置为 `null`。两者为空且无自定义命中时，宿主缓存空的成功结果。实际错误只向客户端返回分类，避免透出可能包含密钥的原始响应或连接错误。

EasyScholar 返回 `40006` 表示密钥的累计查询额度已耗尽。宿主结束该密钥当前待处理的查询，保留已有缓存，并在一分钟内直接返回额度状态。更换密钥后可立即恢复查询。

浏览器只有一份 `lib/client.js`；所有表面在 `remote.zotero` 挂载后注册；文献面板及其配置行受 `whileServed('library')` 门控，未组合时不注册面板表面，也不发起面板请求。共享 DTO 不导入宿主执行上下文、不扩充宿主 `JobKindMap`、不经全文 spill 回调引入读取实现；写入审批上下文与 job kinds 只由宿主入口持有。浏览器单独编译且无 Node 全局，声明门禁读取 TypeScript 实际解析的文件清单，拒绝宿主 jobs/tools/agent 根入口。

表面包括文献轨迹（`conversation.view`，id `zotero`，order 30）、文献面板（`sidebarRightTabs` + `sidebar.right.pane.tab`）、工具卡片（`tool.call.toolview`）、设置与插件管理（`plugins.bundle.config` 等）、右键菜单（`contextMenus`）、文档预览动作（`sidebar.right.tab.document.actions` / `.unpreviewable`）。面板的数据面、访问门禁、会话绑定、导航状态与写入口以 `src/client/**` 的实现为准；布局档位在 `library.module.css`，用户可见行为在 `features.md`。

披露：组件被 serve 且本浏览器尚未确认该披露时显示；确认按浏览器保存，客户端观察到组件关闭即撤销，之后重新 serve 再披露；存储失败时由会话状态承载接受与撤销。scholarly 与 enrichment 各一条披露，由共享仲裁器按注册顺序显示，不叠加模态框。

已解析文档管理页按 `listParsedDocuments` 窗口加载；行按 artifactId 打开、重新解析或删除，删除先确认并刷新已打开解析页。解析结果页的地址只包含会话与附件 ref（URL 来源用 artifactId），宿主 `useResource` 准备完整正文与图片后一次发布；刷新期间保留旧文档，成功后整体换代。解析回执触发当前会话已打开页面的更新：客户端用免租约 `meta` 确认来源的当前索引，附件页保留地址并刷新，产物页通过 `replaceTab` 保留原位置，切换清理旧选区和 blob URL。

FTS5 覆盖率按已提交产物的 artifactId、sourceId、generation 与 Markdown 摘要核对当前分区。重建作业将重新分词的段落逐篇写入私有暂存数据库。发布前在产物锁内重新核对代次和摘要，再用一个 SQLite 事务替换分区数据与 FTS5 表。取消、产物版本漂移或重建失败保留上一个已提交分区。界面只在可见且有活动作业时持续读取进度。

批量解析先在同一 Zotero 实例和库版本下逐页读取 PDF 附件元数据，按父条目键分批补齐文献字段，并按会话保存带过期时间的清单快照。确认请求绑定清单、选择集合与操作 ID；全选表示该快照的全部 PDF 减去明确排除项。后台队列逐项接纳到现有解析作业，同一批次同时运行一项，复用单篇解析的代次、来源锁、回执和授权复查。取消撤销当前批次对解析的等待并跳过尚未接纳的附件。批次摘要随宿主和会话生命周期保留，单篇持久回执沿用现有存储。

解释/提问卡要求模型以 `mode="fulltext"`、`complete=true` 一次读取整篇有界文档；结果带 `spillRef` 时用宿主 `read`/`grep` 读句柄，否则读内联正文；完整读取不可用时回退窗口链。随后按界面语言分块解释（一句话主旨、论证位置、实质内容、范围与依据），引用原文或文献细节前先核对。界面语言只存在于浏览器，客户端把语言名写进 prompt；该上游缺口的补丁见 `development-notes.md` 的 DN-49。

导航：`useLibraryNavigation` 管理连续前缀、库版本、在途去重、最多四个导航任务；存储采用 v3 键与格式，按实例与会话隔离，只保留状态与视图标记。`collectionPath({library, ref, libraryVersion})` 经 `ctx.zoteroLibrary` → `ctx.zotero` → Local Provider，使用 browse 能力门控；返回根至目标的真实合集行与库版本，结束时用轻量列表读取校验版本。合集与保存搜索分页必须携带有效 `Last-Modified-Version`，双端 codec 拒绝缺失版本。

诊断：500 条进程内环形缓冲记录 HTTP 请求、工具调用、job 状态、配置变更、写门禁、shell 直写检测、连接探测与降级；`tool.result` 在结果发布时记录，失败为 warn 并带稳定 `errorCode`，`ms` 从进入 `tools/execute` 到结果发布。默认不记录请求行；开启诊断后额外记录并合并连续相同条目。`zotero/diagnostics` 按时间倒序返回快照；前端诊断卡只在开启诊断且面板可见时轮询。记录只在内存，不落盘、不外发遥测；HTTP 记录不含响应体与文献正文。

## 设计边界

文献库默认只读；开启 `writeEnabled` 后仅允许写入个人库（`zotero://user/0/`）。本地请求严格限制在环回地址，拒绝重定向；外部学术检索由 scholarly 授权，用户主动的 URL PDF 阅读由文献面板独立授权；MinerU 请求只由用户针对具体目标主动提交的 enrichment 解析任务发起；本地语义不联系 MinerU，模型下载独立发起。

无常驻轮询守护进程与遥测收集；核心、scholarly 与 enrichment 的长任务都由 `ctx.jobs` 承载。后台解析与下载在卸载时中止并等待清理，已接纳的前台读取作用域排空后释放。文献轨迹只展示本会话读类工具与导出产生的事实，不记录写入，也不含库外文献；回收站是文献面板专有范围，模型工具 schema 不提供。
Reader 编辑标注时携带表单所显示的版本。审批后，领域层从锁定的实例读出当前对象，核对标注类型和版本，并将该版本与既有请求头一并随 PATCH 提交到 Zotero。冲突时 Reader 刷新标注列表，由用户决定是否重新提交。`tests/local/write/annotations.spec.ts` 验证 Local API 请求及过期版本拒绝。

Reader 通过 PDF.js viewport 转换文本节点的矩形坐标，每个物理页提交一条原生标注。选区缺少页面几何或文本被截断时禁用创建。计划审查展示各页原文、颜色与评论，领域层在锁定的 Zotero 实例中校验附件，再提交一个批次。回执逐页报告结果。PDF 浏览器 smoke 验证旋转后的逆向跨行、跨页选区，宿主与 Local API 标注测试验证两级审批、原生请求及部分失败或提交情况不明的回执。

Reader 在标量编辑使用的同一版本下合并标注的标签变更，保留未移除标签的类型。删除先在标签页确认具体标注，再经宿主两级审批调用 Zotero 的单条目版本化 DELETE。审批需要活跃轮次时，Reader 保留待提交的编辑或删除确认。版本过期时刷新列表。提交情况不明时返回标注 ref，供用户在 Zotero 核对。Local API 标注测试校验版本头、标签保留和删除结果不明的处理。

取消编辑或删除标注时，若原 Reader 标签页仍可见，焦点回到该标签页内触发操作的按钮。`tests/client/reader/ReaderTab.annotations.spec.tsx` 覆盖同时打开同一附件的两个视图，以及焦点回调前隐藏或关闭原标签页的情况。

Reader 通过核心的 Markdown 笔记流程新建关联笔记。审批后，编辑流程在锁定的 Zotero 实例中核对界面所见版本，只在解析确认的普通文本片段位置写入转义后的文本及可选的粗体、斜体或代码格式，保留周围的 Zotero HTML、引文属性、标注反链及图片。片段内的格式选区使用提交文字的半开 UTF-16 偏移；写入前会校验两个边界，再转义并包裹选中文字。领域层重读保存的笔记以核验版本与内容。永久删除使用同样的版本校验及单条目 DELETE。草稿按 DSH 会话及带服务器限定符的条目存入浏览器会话存储。存储拒绝写入时，当前浏览器标签页在内存保留最多 16 条记录，包括用来覆盖旧存档的清除标记。版本不一致或提交结果未核验时，用户可以打开只读草稿并复制原文。经核验的保存会清除草稿。`tests/local/write/reader-notes.spec.ts` 验证标记保留与回读。宿主和客户端笔记测试覆盖审批、冲突和草稿恢复。


<p align="right"><a href="skills.en.md"><b>English</b></a></p>

# 研究 SOP 技能参考

本页面向使用和维护研究流程的用户与开发者。技能是分阶段的指令。模型先从短目录选择技能，再通过 Harness 的 `skill` 工具加载完整 Markdown SOP；完整正文不进入常驻 system prompt。目录保留技能名称和短描述，仍会占用少量 Token。

技能目录（name 与 description）及 triggerKeywords 统一使用英文，中文提问由模型跨语言匹配。`tests/host/skill-contracts.spec.ts` 断言其中不含中文字符。

## 选择技能

| 技能                                | 组件      | 输入与产出                                           | 职责边界                                     |
| ----------------------------------- | --------- | ---------------------------------------------------- | -------------------------------------------- |
| `zotero-research-landscape`         | Scholarly | 研究问题 → 检索日志、主题簇、锚点与待核实空白        | 开题与主题发现，不做种子论文引文追踪         |
| `zotero-citation-lineage`           | Scholarly | 种子 DOI/arXiv/PMID → 有向引文边及未覆盖分支         | 引用关系不等于支持或因果；相似关系单列       |
| `zotero-paper-digest`               | 核心      | 单篇文献 → 元数据、核心论点/证据片段与 BibTeX 简报   | 单篇速读提炼，不做多篇横向对比或主题扩展     |
| `zotero-evidence-synthesis`         | 核心      | 固定 2–12 篇文献 → 带出处的实验/方法比较矩阵         | 比较研究证据，不检查草稿逐条主张             |
| `zotero-manuscript-reference-audit` | 核心      | 用户提供的草稿/书目 → 主张、引文、记录、原文的核对表 | 不编辑文稿文件，不扩展主题检索               |
| `zotero-library-governance`         | 核心      | 已有库的明确范围 → 字段/标签/合集差异与经审批修正    | 不发现或导入库外文献，不自动合并/删除重复项  |
| `zotero-publication-integrity`      | Scholarly | 明确可疑文献 → 身份、字段与来源报告的撤稿状态        | 调查具体疑点，不重复整稿例行核验             |
| `zotero-literature-intake`          | Scholarly | 用户选定的库外文献 → 核验、去重、审批、入库回执      | 不自主检索更多文献；保存元数据不代表下载 PDF |

Scholarly 指 `dsh-zotero/scholarly` 组件。该组件未启用时，四个对应技能不注册。四个核心技能可以在工具可用时使用条件化的外部核验或全文配方；不可用时交付本地结果和证据缺口，不能借用 shell 或其他网络入口绕过组件授权。

## 阶段、批处理与停止条件

每个 SOP 包含四个有序 Phase、结构化 Recipe、失败/终止规则和输出合同。阶段状态保存在模型的精简任务账本中。复用已经获取的身份和证据，交接只传输入 ID、查询、refs、locators、排除理由和未决项。

| 流程     | 顺序                                          | 默认预算与停止条件                                                                                                                  |
| -------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 主题版图 | 界定 → 检索 → 锚点 → 主题与缺口               | 两种查询表述加一次筛选调整，最多 3 次搜索；每次 8 条，最多详查 5 个锚点；两次连续无新增或达到主题覆盖即停                           |
| 引文脉络 | 种子 → 首跳 → 精选前沿 → 有向关系             | 最多两跳、5 次图查询、展开 3 个首跳节点，每次 10 条；visited 去重，空前沿即停                                                       |
| 单篇速读 | 元数据与附件 → 聚焦证据 → 引用生成 → 简报组装 | 限制单篇；至多 4 段核心证据；无正文时仅摘要降级，输出即停                                                                           |
| 证据比较 | 固定语料/维度 → 定位 → BM25 → 比较            | 每篇最多两次 BM25（包含一次改写）；本地段落不超过 6 且遵守更小配置上限，外部不超过 5；最后可读取一个不超过 4000 字符的定向章节/片段 |
| 写作对账 | 清单 → 身份 → 支持 → 差异                     | 每个唯一主张/ref 问题最多两次 BM25、每次 4 段；只有输入指纹变更才重跑一次匹配；每条输入均有结论后停止                               |
| 文库治理 | 定界 → 检查 → 变更提案 → 审批与核验           | 默认 5 页、100 条顶层条目；用户可在执行前明确扩大一次范围；不完整目录阻止写入，不常驻扫描                                           |
| 真伪审查 | 固定疑点 → 注册库 → 交叉索引 → 报告           | 每批最多 40 条核验；最多 10 篇疑点各交叉查一次；索引失败不改写成“文献不存在”                                                        |
| 文献入库 | 固定选择 → 核验去重 → 字段映射 → 审批落定     | 核验每批 40、匹配每批 50；多篇优先核心批量创建，总操作数不超过 50 及配置上限；部分失败或未核验提交即停止后续批次                    |

已知本地 refs 优先批量读取，每次最多 50 个唯一 refs，标准字段即可；外部指纹先批量本地匹配，每条必须有唯一 `inputId` 及 DOI 或标题。不要逐篇重复扫描 DOI 全库匹配。参数名错误只允许对照 schema 修正一次，不能换名试探。

## 证据与安全边界

- 阅读先定位目录/章节，再检索与问题相关的 BM25 片段，最后引用短原文和真实 locator。本地索引全文没有目录 API，可从附件元数据/批注定位；不能假装读过目录，也不能退化为从头通读全部全文。
- 只有 Zotero 原生 annotation 可能提供 `pageLabel`；本地全文及 Scholarly 段落不保证页码。没有页码时明确注明，以真实章节、字符或 chunk 位置定位。用户批注评论不当作论文原文。
- 注册库 `UNVERIFIED` 不等于 `NOT FOUND`；相似标题不等于身份一致；未报告撤稿不等于已证明未撤稿。撤稿输出必须标出检查日期、回答的索引和缺失来源。
- 写入必须由根 Agent 在用户明确要求后，经 `ctx.zotero` 的能力门、`ctx.approval.request` 和 plan-review 卡执行。Skill 无审批豁免权；子 Agent 只返回拟议改动。`committed-unverified` 或批次未核验项只对账，不重试。
- 子 Agent 按持久会话 `origin`/`delegationDepth` 判断，包含恢复为运行时 root 的派生会话。15 个核心写工具和 Scholarly 的保存入口均被隐藏，执行 guard 也拒绝按名称绕入；根 Agent 的审批路径不变。

## 注册与维护

`src/skills/` 为纯 Host 模块。每个 SOP 独立定义 TypeScript 数据和 Markdown 指令，`definition.ts` 统一渲染共享合同及 JSON Recipe，`register.ts` 通过可选 `ctx.inject(['skills'])` 注册。核心服务持有 4 个 SOP，Scholarly 服务持有 4 个；组件或 registry 卸载时由 fiber 清理，registry 后挂载或替换后自动重绑。

Harness 基础组合提供 `dsh-skill` registry 和 `dsh-tool-skill` 消费端；自定义组合也需要两者。依赖版本由 `npm run harness:pin -- 0.2.2-rc.1` 生成，锁文件通过 npm 更新。

测试归属：`tests/host/skills.spec.ts` 验证组合与生命周期；`tests/scholarly/skills.spec.ts` 验证外部授权目录；`tests/host/skill-contracts.spec.ts` 双向校验全部 Recipe，把 recipe 参数、中英文工具参考的参数表与真实 schema properties 逐项对照，并递归校验嵌套键、扫描模型可见字段中的工具名；`tests/host/subagent-view.spec.ts` 验证 scoped 视图与限制生命周期，`tests/host/subagent-guard.spec.ts` 验证执行期拒绝与刷新失败容纳；`tests/unit/client-graph-authority.spec.ts` 拒绝浏览器导入。测试均不访问真实文库或外部索引。

发布前运行 focused specs、`npm run typecheck`、`npm test` 和 `npm run release:check`。构建直接编译 TS 正文，无需复制 Markdown 资源。发布门禁继续验证客户端边界、覆盖率、构建和打包；工具字段合同见 [工具参考](tools.md)。

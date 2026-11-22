<p align="right"><a href="development-notes.en.md"><b>English</b></a></p>

# 开发留意

<!-- harness-reviewed: 0.2.2-rc.5 -->

当前宿主契约复核：2026-11-21，pin `0.2.2-rc.5`。本文只保留上游补丁；每条已对照当前实现与测试复核。

## 定位

本文只记录一种情况：我们使用了上游（`deepseek-harness` 或外部工具）的能力，但上游当前的不完善、缺陷或缺失迫使我们在本仓库打补丁，并等待上游提供更好的替换。上游破坏性变更一旦已适配，不记录；内部架构约束、测试与发布门禁分别由 `architecture.md`、`tests/README.md` 和 `development.md` 拥有，也不在这里重复。

## 记录要求

- **上游**：能力来自哪个宿主或外部工具，当前 pin 或版本。
- **上游特性**：我们使用了什么能力。
- **上游缺陷**：为什么不能按上游公开契约直接使用；写现象和影响。
- **本地补丁**：本仓库怎么绕行，涉及哪些符号。
- **为什么是妥协**：补丁依赖的假设、代价、不能做的事。
- **上游期望**：上游提供什么能力后可以删除补丁；写成可判定的条件。
- **复核触发**：何时重新检查，检查哪个上游文件、符号或命令。
- **验证**：当前补丁如何被测试证明。
- **后续处理**：上游满足期望后的删除或迁移步骤。

## 升级复核

每次 harness pin 变更都逐条核对“上游期望”：已提供就同一次改动完成迁移并删除本条；没有提供就只更新 pin 与复核日期。已适配的破坏性变更不新增条目。

## DN-1：面板解析完成通知的抑制

- **上游**：`@deepseek-ai/dsh-jobs` 与 `dsh-tool-jobs`（pin `0.2.2-rc.5`）。
- **上游特性**：面板解析 job 通过 `ctx.jobs` 承载，结算后宿主向所属会话投递“后台任务状态更新”。
- **上游缺陷**：通知只要求模型读取 job 输出；解析 job 的输出是回执（artifactId、字符数、有界 preview），没有正文或可读路径。空闲会话被 `followup` 唤醒，模型翻找主机文件并输出没人要求的报告。
- **本地补丁**：`src/enrichment/parse-jobs.ts` 的 `EnrichmentParseJobs` 以 `owner` 注册 job、`toolCall` 留空，并重叠续挂 `ctx.jobs.wait`（`holdNotice`、`PARSE_NOTICE_WAIT_MS`、`PARSE_NOTICE_REARM_MS`）；结算被记为 `awaited`，tool-jobs 的投递条件跳过它。waiter 不消费输出、不取消 job、不删除结算记录。
- **为什么是妥协**：`awaited` 的本义是“某个调用方已收到终态投影”，不等于“这个 job 不需要模型知道”；任何把 `awaited` 解释成“模型已消费”的消费者都会收到假信号。续挂依赖 Node 到期 timer 与 microtask 排空顺序。
- **上游期望**：`JobSpec` 增加 `notify?: false`（或 `modelFacing?: false`）并由 registry 带到 `JobSettledData`；或 `JobView` 暴露 `toolCall`，tool-jobs 只通知工具创建的 job。任一即可删除本补丁。
- **复核触发**：每次 `npm run harness:pin` 后；在 `node_modules/@deepseek-ai/dsh-jobs/src/types.ts` 搜索 `notify`/`silent`/`modelFacing`，在 `view.ts` 搜索 `toolCall`，并复核 tool-jobs 是否仍只跳过 `awaited`。
- **验证**：`tests/host/enrichment-parse-jobs-notice.spec.ts` 覆盖 completed、failed、killed、跨等待窗口，四例均为 `awaited === true`；删除 `holdNotice` 后这些用例必须失败。
- **后续处理**：改用新声明或按来源推断；删除 `holdNotice` 与两个常量；把 spec 断言换成“面板解析不产生通知、模型主动后台 job 仍通知”；同步 `architecture.md` 与 `AGENTS.md`。

## DN-5：打包冒烟必须脱离父进程的 npm dry-run 模式

- **上游**：npm 12 生命周期。
- **上游特性**：`npm publish --dry-run` 运行 `prepublishOnly`，冒烟内嵌套 `npm pack`。
- **上游缺陷**：`npm_config_dry_run=true` 被继承，嵌套 pack 产出 0 个 tarball，`verify:pack` 报错。
- **本地补丁**：`scripts/smoke-archive-worker.mjs` 从子进程环境移除该变量，其余 npm 设置照常继承。
- **为什么是妥协**：只覆盖这条冒烟链；新增嵌套 npm 调用要重新检查。
- **上游期望**：npm 不再把 dry-run 传给生命周期子进程，或提供显式关闭方式。
- **复核触发**：发布脚本链、npm 主版本、新增子进程调用；重跑 `npm publish --dry-run`。
- **验证**：dry-run 日志同时出现 `archive-worker pack smoke ok` 与 `verify-pack ok`；`release:check` 通过。
- **后续处理**：删除环境清理，保留“冒烟产出一个真实 tarball”的断言。

## DN-7：语义排序运行时打进包内

- **上游**：pnpm 11 `strictDepBuilds`；`onnxruntime-web` 传递依赖 `protobufjs` 的空 `postinstall`。
- **上游特性**：本地语义排序使用 onnxruntime-web。
- **上游缺陷**：依赖存在未决定构建脚本时 pnpm 整次安装非零退出（`ERR_PNPM_IGNORED_BUILDS`），桌面插件安装回滚。
- **本地补丁**：运行时不是依赖，而是打进包内的资产：`scripts/vendor-onnxruntime.mjs` 复制 Node 入口、wasm 胶水与二进制到 `assets/onnxruntime/<version>/`，写 `provenance.json`（来源、字节数、SHA-256）与 MIT 许可；`semantic/runtime.ts` 用绝对 URL 加载并把 `env.wasm.wasmPaths` 指向该目录；`verify:pack` 校验哈希、许可与三个资产文件进包。
- **为什么是妥协**：资产是生成产物，升级要重建；`onnxruntime-common` 仍是正常依赖；打包产物 7.0 MB / 解包 27.4 MB（`npm pack --dry-run`，2026-11-21，其中 vendored wasm 14.8 MB）。
- **上游期望**：pnpm 允许或豁免该构建脚本，或 `protobufjs` 8.x（无 `postinstall`）。
- **复核触发**：升级 onnxruntime-web（同步 `SEMANTIC_RUNTIME_VERSION` 与精确 devDependency）、pnpm 主版本、新增运行时依赖。
- **验证**：`vendor-onnxruntime.spec.ts`、`enrichment-semantic-runtime.spec.ts`、`build-approvals.spec.ts`、`verify-pack.spec.ts`；用 pnpm 11 把打包产物装进干净 profile 应零批准通过。
- **后续处理**：改回 dependencies，删除 vendor 脚本、包内资产与相关守卫。

## DN-9：上游「无会话面板」拒绝只是一句散文

- **上游**：`@deepseek-ai/dsh-client-ui-sidebar-right`（pin `0.2.2-rc.5`）。
- **上游特性**：面板用 `openResource` 打开本地 PDF。
- **上游缺陷**：本次会话没有挂载会话面时，上游直接 `throw new Error('sidebarRight: no session surface is mounted')`，没有错误码或可判别类型。
- **本地补丁**：`NO_SESSION_SURFACE_REFUSAL` 子串常量，用 `includes` 匹配（上游带 `sidebarRight: ` 前缀）；其它失败保留原消息。
- **为什么是妥协**：消息文本是唯一判别依据，上游改字就失效。
- **上游期望**：该分支提供错误码或错误类型。
- **复核触发**：每次 pin；`rg "no session surface is mounted" ../deepseek-harness/packages/client/ui-sidebar-right/src`。
- **验证**：`tests/client/library/library-panel.reader.spec.tsx`（拒绝翻译成面板提示，外来拒绝保留原消息）。
- **后续处理**：按 code 判定，删除子串常量。

## DN-10：客户端加载器 API 与 `resultText` 镜像停在 pin 语义

- **上游**：客户端模块加载器与 `resultText`（pin `0.2.2-rc.5`）。
- **上游特性**：插件 CSS 注入与 `load({id,factory})` 交接；`resultTextOf` 生成工具卡文本。
- **上游缺陷**：rc.5 的 `load({id,factory})` 由壳层提供，factory 执行时注入的样式由 loader 认领。`ClientBundleRegistration` 从 `@deepseek-ai/dsh-client-modules/client` 公开导出，rc.5 注册类型没有 `meta` 字段。`resultText` 使用换行拼接，也尚未公开导出。
- **本地补丁**：`scripts/build-client.mjs` 的 `CLIENT_LOADER_API` 与 `assertLoaderApi`；`src/sources/presenters.ts` 的 `resultTextOf` 镜像，JSDoc 写明发布版契约。
- **为什么是妥协**：两处镜像必须随 pin 移动；构建期失败比运行期静默丢样式或 handoff 好。
- **上游期望**：pin 提供 `meta.stylesheets`；`resultText` 从 `./client` 导出。
- **复核触发**：每次 pin；按 `development.md` 的命令从发布标签复核 loader、注册类型及结果文本。
- **验证**：`build-client-bundle.spec.ts`（旧形式通过、两种漂移各自失败）、`presenters.spec.ts`、`build:client`、`harness:check`。
- **后续处理**：翻转常量、迁移样式注入、抬高 `engines.dsh` 下界；删除 `data-plugin-css` 与常量；`resultText` 改值导入并删除镜像。

## DN-13：代理路由与地址钉住互斥

- **上游**：`@deepseek-ai/dsh-http-proxy` 与 undici。
- **上游特性**：外部出口的代理路由与地址钉住。
- **上游缺陷**：代理自己做 DNS，不能同时钉地址；`pinned.dispatcher` 只被同一份 undici 的 `fetch` 接受。
- **本地补丁**：`src/transport/connections.ts` 的 `egressRouteFor`、`proxyRouteFor`、`publicFetch`：proxied 走代理包的进程级 dispatcher（不 close，词法公网闸照跑），direct 解析地址、钉住闭集并每次 close；插件从已安装的 Harness 代理包解析 undici，使 profile 与 CLI 分装时也共用 dispatcher 和 fetch 所属模块。
- **为什么是妥协**：proxied 请求依赖代理 DNS，direct 请求依赖本地解析；混用等于放弃 check-then-connect。
- **上游期望**：上游把 proxy 与 pinning 合成一条 API。
- **复核触发**：harness 代理版本、undici 更换、新增外部出口。`harness:check` 核对仓库共用的锁记录，打包冒烟验证插件 fetch 来自代理实际安装的 undici。`deps:check` 报告高于宿主约束的发行版。
- **验证**：`tests/host/*-proxy*`、`tests/scholarly/network.spec.ts`、`fake-ip-policy.spec.ts`、test-lint 的 fetch 归属检查。
- **后续处理**：删除 `egressRouteFor`，改用合并 API。

## DN-17：样式 token 的 pin 来源

- **上游**：宿主 theme 与 token 源码（pin）。
- **上游特性**：客户端 CSS 消费宿主 token，`style:check` 校验。
- **上游缺陷**：没有完整的公开 token 清单；来源是 theme sheet 与运行时 seam。
- **本地补丁**：`scripts/style-tokens.mjs` 在 CI 读 lockfile 安装的精确 theme，链接开发读 sibling pin tag；`RUNTIME_SEAMS`/`verifyRuntimeSeams` 逐项对应设置、CSS 定义或 `setProperty` 调用；来源表与快照闭合。
- **为什么是妥协**：依赖 pin 的内部实现，移动定义会失败。
- **上游期望**：上游提供完整 token 清单。
- **复核触发**：pin、增加 token、移动上游定义。
- **验证**：`tokens:check`（在 `release:check` 中）、`style-tokens.spec.ts`。
- **后续处理**：用公开清单替换来源表，保留精确 pin 与删除检查。

## DN-24：上游镜像、静态清单与搜索折叠复验

- **上游**：Cordis 枚举、Typert 生成器、工具执行、Zotero 搜索内部。
- **上游特性**：服务状态/日志枚举、Typert RPC、动态写工具注册、搜索折叠。
- **上游缺陷**：const enum 没有运行时对象；Typert 生成器要求 monorepo；面板 `tools.execute` 不带 toolSet，`when` 不能替代注册生命周期；Zotero `normalizeForSearch` 是内部实现。
- **本地补丁**：`src/fiber-state.ts` 的类型锚定数值镜像与穷举表；`src/typert.ts` 的严格 descriptor 表派生宿主/浏览器成员；动态写工具注册；`src/search-text.ts` 镜像与 `scripts/verify-zotero-search.mjs`。
- **为什么是妥协**：镜像要随 pin/Zotero 升级复核；验证器以实际源为准，不能用镜像生成预期值。
- **上游期望**：运行时枚举导出；独立仓库可用的 Typert 生成器；面板执行获得 toolSet；Zotero 提供稳定搜索契约。
- **复核触发**：pin、枚举/日志变化、工具执行语义、生成器布局、Zotero 升级、`search-text.ts` 修改。
- **验证**：`npm run typecheck`、`typert-parity`、Remote 契约与写策略测试、`verify-zotero-search.mjs`。
- **后续处理**：出现运行时导出即删镜像；生成器支持独立仓库即迁移；获得 toolSet 后重评动态注册；搜索等值失败先核对源版本。

## DN-27：工具参数名在执行前封闭

- **上游**：工具参数 DSL（rc.5）。
- **上游特性**：工具注册与参数验证。
- **上游缺陷**：DSL 生成开放根对象，未知根参数会被接受。
- **本地补丁**：统一构造器标 `additionalProperties: false`，发现未知根参数时调用宿主 `validateJsonSchemaValue` 并抛 `ToolArgsError`，在执行前拒绝；已声明字段仍由 `defineTool` 验证；唯一近似匹配覆盖缺失必填/可选参数，不猜歧义名称。
- **为什么是妥协**：本地闭包层重复了部分宿主契约；动态后台参数只在实际注册时可用。
- **上游期望**：宿主公开封闭参数根的 DSL。
- **复核触发**：工具 DSL、执行管线、参数错误类型、新增工具或动态参数。
- **验证**：`tool-parameter-closure`（全部 30 个真实注册与零副作用拒绝）、`parameter-correction`、工具与 scholarly 行为测试。
- **后续处理**：直接用宿主能力，删除本地根参数拒绝分支。

## DN-29：公开测试支持与注册表入口差异

- **上游**：测试支持包（rc.5）。
- **上游特性**：host lane 的 `executeModelToolFixture`、`TestClient`/`SlotTestRuntime`、发布入口。
- **上游缺陷**：完整 runtime 根入口依赖加载器形式的 `/client` 产物；包内 Vitest 4 与仓库 Vitest 5 会分裂。
- **本地补丁**：测试支持源码门禁的精确发布清单；`client-test-platform.mjs` 把类型路径映射到显式发布的生产源码，缺契约或文件即失败；Vitest 单实例；真实 `TestClient`/`SlotTestRuntime`；pin 脚本补齐 harness overrides。
- **为什么是妥协**：源码映射是维护清单；缺文件会让门禁失败。
- **上游期望**：`/client` 入口公开为可直接执行的 ESM。
- **复核触发**：测试支持包、客户端加载器、测试运行器、pin 写入逻辑。
- **验证**：host/tool 真实调用、`harness-state`、`test-lint`、locale/客户端 DOM/发布检查。
- **后续处理**：删除发布源码映射与入口例外。

## DN-40：宿主交付按钮的私有路由适配

- **上游**：`deliverables.file.actions`（pin）。
- **上游特性**：交付文件按钮。
- **上游缺陷**：owner props 不提供文件 path。
- **本地补丁**：只接受 `api/present.open` 的 `sessionId`、正整数 `seq`、非负整数 `index`，再通过 ChatSnapshot 定位文件；未知路由或坐标记日志；文件右键菜单保留。
- **为什么是妥协**：私有路由不是公开契约；坐标形状变化会失效。
- **上游期望**：公开 path 或文件身份。
- **复核触发**：pin、present-open 路由、slot owner props。
- **验证**：`tests/client/deliverables/`、`smoke:web-composition`。
- **后续处理**：改用公开字段，删除解析器。

## DN-42：按钮样式的归属与内容行布局

- **上游**：宿主 `Button`（pin）。
- **上游特性**：所有控件使用宿主 Button。
- **上游缺陷**：只有固定块高 `md`/`sm`，没有内容高度参数。
- **本地补丁**：`ContentButton` 用原生 `style.height="auto"` 作为唯一宿主覆盖；行高由标题/元数据/内边距决定；图标尺寸与窄容器图标席位由共用 IconButton 适配；业务样式不覆盖宿主颜色或几何。
- **为什么是妥协**：受限例外；字号、横向内边距、圆角、hover、焦点仍由宿主提供。
- **上游期望**：内容高度或图标按钮 API。
- **复核触发**：Button 内容高度/图标 API、尺寸阶梯、新包装器。
- **验证**：`control-style-ownership` 门禁（JSX 导入到 CSS；只放行 `height:auto` 与图标尺寸/圆角）；真实浏览器验收。
- **后续处理**：用宿主 API 替换适配，保留业务样式归属门禁。

## DN-49：解释作答的界面语言注入

- **上游**：客户端 `ctx.locale` 与模型请求（pin）。
- **上游特性**：解释与提问按界面语言作答。
- **上游缺陷**：生效界面语言只存在于浏览器，宿主与模型请求都不携带它。
- **本地补丁**：`src/client/answer-language.ts` 把语言名（如 `Simplified Chinese (简体中文, zh)`）写进 `parsedExplainPrompt` 与 `libraryAskFulltextPrompt`。
- **为什么是妥协**：prompt 携带显示名；新增语言要先能被 `Intl.DisplayNames` 命名。
- **上游期望**：宿主向模型暴露界面语言。
- **复核触发**：`ctx.locale` 服务、prompt 形状、新增语言包。
- **验证**：`tests/client/answer-language.spec.ts`、`tests/client/library/parsed-document-*.spec.tsx`、`library-inspector.spec.tsx`。
- **后续处理**：宿主暴露语言后删除客户端注入；保留解释与提问的行为约束。

## DN-50：本轮证据与写入计划的会话位置

- **上游**：rc.5 的 `conversation.view`、`conversation.chat.turnTail`、`ui-input-trigger` 与审批命令。
- **上游特性**：插件能注册会话页、本轮尾部视图和输入触发器。
- **上游缺陷**：发布版未提供常驻会话侧栏。宿主审批命令占用唯一的 `conversation.approval.detail` 插槽，审批响应缺少完整计划反馈字段。
- **本地补丁**：文献轨迹使用会话页，本轮证据使用尾部视图。输入支持 `@paper`。会话批准与 Zotero 计划审阅保留各自的响应。
- **为什么是妥协**：跨轮文献轨迹位于单独的会话页，写工具先取得会话授权，再审阅具体计划。
- **上游期望**：提供常驻会话侧栏、可组合的审批详情及结构化审批反馈。
- **复核触发**：升级宿主 pin 时对照客户端插槽声明及审批响应类型。
- **验证**：`tests/client/apply-gating.spec.ts`、`tests/client/apply.spec.ts` 与计划审阅和写入用例。
- **后续处理**：接入已发布的侧栏和可组合审批详情，保留文献引用与完整修改意见。

## DN-51：按请求条目限定 Local API 导出结果

- **上游**：Zotero 桌面端 Local API（`127.0.0.1:23119/api`，实测 `11.0-beta.4`）。
- **上游特性**：`GET /users/0/items?itemKey=KEY` 按 key 返回条目，命中父条目时会一并返回其子项。`include=data,csljson` 在每个对象的 JSON 行内附带该对象的 CSL JSON 导出。
- **上游缺陷**：响应多出的子项行会让按请求集合核对的书目、BibTeX 等格式校验失败；直接请求 `format=csljson` 时，展开的附件或笔记也会写进正文。
- **本地补丁**：`src/local/export-domain.ts` 的 `fetchRawItemBatch` 只保留请求 key 的响应行，并要求每个 key 恰好出现一次。CSL JSON 正文逐行取自验证后的 `csljson` 字段，按响应顺序组装，记录 `entryIndex`；引用键来自同一行。
- **为什么是妥协**：Local API 会先为展开的子项生成 CSL JSON，插件只能从响应中挑出请求对象；其他整批格式继续使用 Zotero 返回的正文。
- **上游期望**：提供关闭子项展开的查询选项，让原始响应和导出正文都只含请求的 key。
- **复核触发**：Zotero 更新条目范围或 CSL JSON 序列化后，用带附件和笔记的父条目复核原始响应与导出正文。
- **验证**：`tests/local/export-item-scope.spec.ts` 覆盖范围展开、重复 key、显式请求子项和 CSL JSON 正文定位。
- **后续处理**：上游提供精确批读和可定位的批量导出时，可移除这一适配。

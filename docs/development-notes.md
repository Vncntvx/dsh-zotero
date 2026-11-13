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

上游契约绕行还必须补充：当前现象、现做法、妥协原因和具体的上游期望。缺少验证方式或后续处理的条目视为不完整。上游 pin 每次升级时，`## 升级复核` 的流程必跑。

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

## 升级复核

每次 harness pin 变更都从本文开头逐条核对：上游契约是否已经提供期望能力；提供了就必须在同一次改动中完成迁移并退役条目，不允许“能力已到、绕行还在”的状态长期存在。没有提供能力时，只更新 pin 版本号与复核日期，不修改绕行实现。

## 已退役条目

目前没有。退役条目保留标题、退役时间和替代机制，便于回溯为什么曾经这样做。

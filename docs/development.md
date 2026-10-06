<p align="right"><a href="development.en.md"><b>English</b></a></p>

# 开发指南

## 仓库结构

```text
src/
  index.ts              # 插件入口（纯 re-export）
  service.ts            # ZoteroService（Cordis 服务）
  local/provider.ts     # LocalApiProvider（Zotero Local API 适配）
  local/*-domain.ts     # 领域管线（search、export、changes、browse、write 等）
  local/                # 辅助模块：detail、retrieve、attachment-location、scope-directory 等
  http-client.ts        # HTTP 传输层（环回 fetch、流式与并发槽位控制）
  config.ts             # 配置 Schema 与校验逻辑
  types.ts              # 领域 DTO 与类型定义
  contract.ts           # Remote wire 协议面与常量
  status-codec.ts       # Host 端状态解码（zod）
  errors.ts             # 错误类与错误码
  json.ts               # 无损 JSON 读取辅助函数
  evidence-item.ts      # 证据项投影定义（端侧共享）
  constants.ts          # 常量定义
  concurrency.ts        # 有界并发控制器
  evidence.ts           # BM25 排序算法
  search-text.ts        # 与 Zotero normalizeForSearch 一致的搜索折叠
  attachments.ts        # 附件选择与优先级逻辑
  normalize.ts          # Zotero 响应至领域 DTO 的归一化转换
  presentation-meta.ts  # 工具结果的展示投影
  refs.ts               # Zotero ref 语法解析与格式化
  ref-grammar.ts        # 引用语法校验模式
  export-items.ts       # 逐文档导出解析
  export-mapping.ts     # 引用与批量条目映射
  ask.ts                # 连接失败时的用户交互提示与重试协调
  prompt.ts             # 面向模型的系统提示词
  command.ts            # /zotero 状态命令
  write-approval.ts     # 写入双层确认（审批策略与计划审查卡）
  write-auth.ts         # Zotero 本地写入密钥获取与持久化
  write-http.ts         # 本地写入 HTTP 请求处理
  shell-write-detector.ts # 直写本地 API 的 shell 命令拦截检测
  remote.ts             # Web 端 Remote 服务
  typert.ts             # Typert 清单
  settings-namespace.ts # 设置命名空间常量
  tools/                # 16 个模型工具定义（8 读 + 8 写）
  client/               # 浏览器端（设置页、Sources 面板、工具卡片视图）
tests/                  # 单元测试与端到端测试用例
```

## 安装与构建

```sh
npm install                  # 依赖安装（与 deepseek-harness 并列）
npm test                     # 单元测试与测试规范检查
npm run typecheck            # 类型检查（包含 Node、测试与浏览器端工程）
npm run build                # 编译全部产物（tsc → lib/，esbuild → lib/client.js）
npm run build:client         # 仅构建浏览器端产物
npm run test:coverage        # 覆盖率门禁检查
npm run harness:check        # 检查上游 Harness 版本钉与声明一致性
npm run harness:pin -- <ver> # 统一更新 Harness 依赖版本钉
npm run verify:pack          # 校验打包产物文件完整性
npm run smoke                # 生产栈冒烟：在 dsh profile 内对真实 Zotero 调用全部读工具
npm run smoke:discovery      # 打包产物 → 临时 profile → dsh web 启动探针
npm run release:branch       # 切出可发布的 release 分支（清单驱动）
npm run lint:test            # 仅运行测试规范守卫
npm run test:watch           # vitest watch 模式
npm run format               # 执行 Prettier 格式化
npm run format:check         # 检查代码格式
```

`prepare`（npm install 时触发）从源码构建 `lib/`；`prepublishOnly` 在发布前运行 `release:check`。

说明：本仓库通常与 `deepseek-harness` 作为 sibling 目录并列开发。类型定义通过符号链接读取上游构建产物。若上游代码发生更新，需先在上游执行构建以同步声明文件。

## 集成测试

```sh
npm run test:integration
```

集成测试需要本地 Zotero 运行在 `127.0.0.1:23119` 并启用本地 API 通信。

## 构建产物

- **Node 端产物**（`lib/`）：由 `tsc` 编译生成，包含服务逻辑、工具定义、Provider 与传输层；
- **浏览器端产物**（`lib/client.js`）：由 `esbuild` 打包生成，包含设置页、Sources 面板与会话卡片。

## 本地调试

### 完整插件调试（含 Web 界面）

```sh
export DSH_HOME=$(mktemp -d /tmp/dsh-zotero-dev-XXXX)
cp ~/.dsh/.credentials.yaml ~/.dsh/settings.yaml "$DSH_HOME/"
chmod 600 "$DSH_HOME/.credentials.yaml" "$DSH_HOME/settings.yaml"
npm run build
dsh plugin --profile web add .
npm run dev &        # 监听 Node 端变更
npm run dev:client & # 监听浏览器端变更
cd ../deepseek-harness && env DSH_HOME="$DSH_HOME" \
  node --import tsx/esm apps/cli/src/bin.ts web --port 3307
```

### 仅 Host 端调试（支持 HMR）

```sh
npm run build                                    # 首次构建 lib/ 目录
npm run dev &                                    # 监听并自动增量编译至 lib/
cp dev-lib.cordis.yml.example dev-lib.cordis.yml # 复制叠加层模板并配置实际绝对路径
dsh web --patch ./dev-lib.cordis.yml --port 3307
```

> **注意**：`dev-lib.cordis.yml` 叠加层通过配置构建入口的绝对路径（`<absolute-path-to-dsh-zotero>/lib/index.js`）加载插件，使得 Host 端（模型工具与 `/zotero` 命令行）能在 Loader 监视下实现免重启热重载；但 Harness 客户端模块加载器仅解析已注册的裸包名，因此该模式**不加载浏览器端前端组件（设置页与 Sources Tab）**。如需调试前端 UI，请使用上述「完整插件调试」流程（`dsh plugin --profile web add .` 与 `npm run dev:client`）。

## 测试规范

- 单元测试运行于模拟 Zotero HTTP 服务（MockZotero）上；
- 浏览器设置页测试基于 JSDOM 与 `@testing-library/react`；
- 覆盖率阈值定义在 `vitest.config.ts` 中，对各核心分层分别设置门禁指标；
- 集成测试针对真实运行的 Zotero 实例验证网络协议与真实数据。

## 发布检查清单

在发布版本前，请确保以下检查全部通过：

1. `npm run harness:check -- --strict`：版本钉及上游声明无偏差；
2. `npm run verify:pack`：打包 tarball 包含全部必须文件；
3. `npm test`：全部测试通过；
4. `npm run typecheck`：类型检查通过；
5. `npm run test:coverage`：覆盖率达标；
6. `npm run format:check`：代码格式规范；
7. `npm run build`：生产构建成功；
8. 验证 [使用场景](scenarios.md) 中的主流程用例（G1 至 G8），若启用写入需验证 W1 至 W8。

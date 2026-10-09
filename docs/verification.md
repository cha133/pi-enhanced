# 验证状态

版本：`0.1.0`

最后更新：2026-10-09

## PowerShell 引用与破坏性路径指导（2026-10-09）

- 检查本地原始 session：`01a12012-39d2-76e2-9644-0ce1446b8bd8` 的 `powershell:5` 在嵌套插值中把 `\"` 留在实际源码，出现 CommandNotFound 错误但工具返回 exit 0；`01a12005-1642-7015-a01c-9173c7083c8a` 的 `powershell:26` 漏了字符串开引号，返回 exit 1。两条 session 的请求记录均包含旧的反引号指导，未发现执行器改写这些引号的证据；错误调用本身没有删除操作。
- 补齐 JSON/PowerShell/原生命令参数三个层次的引用指导与例子；复杂代码通过 write 写临时脚本。增加最终绝对路径授权范围校验、LiteralPath、失败 throw 与禁止跨 shell 删除的 prompt 要求，不改变执行器语义，不构成强制安全边界。
- 新增测试覆盖 5.1、7、未知版本的指导注入；经同一工具执行链实际验证单引号加倍、双引号反引号、格式化替代嵌套插值、JSON 解码及 here-string，PowerShell 7 与 5.1 均保留内容。删除文本仅作为输出字符串验证，不执行破坏性命令；无需凭据或外部模型。
- 自动验证：`npm run typecheck`、`npm test`（51 项）、`npm pack --dry-run` 通过；未验证真实模型以后会始终遵循新指导。

## PowerShell 版本与执行器绑定修复（2026-10-09）

- 检查 session `01a11ffa-b183-76eb-96c3-785b2ddbe48b`：system rules 已为 7+，但 description 仍写可 fallback 到 5.1；实际版本调用返回 5.1，另一目录调用呈现 7 风格输出。证明指导与执行未绑定，未稳定复现当时单次 PATH 查找漂移的触发原因。
- 初始化缓存原生选择的路径/参数/版本；固定路径 operations 保留原生进程生命周期，并记录 pi 1.1.0 来源。description、snippet 与 guidelines 明确实际版本和语法，未查明版本不静默换成 5.1。
- 新增测试：配置/版本缓存、探测失败保留选定路径、查找失败、初始化后 PATH 切至只有 5.1 的目录时并发执行仍使用选定文件，以及实际 timeout/abort 回归。
- 使用用户安装的 Scoop pi 1.1.0 二进制，禁用自动扩展、MCP 与网络，以临时扩展在 session_start 直接执行本包工具；三轮并发共六次均返回 7.6.6 和选定 pwsh.exe 路径，description 明确 PowerShell 7。未调用模型或修改用户设置/历史会话。
- 自动验证：`npm run typecheck`、`npm test`（49 项）、`npm pack --dry-run` 通过；仍只有一个公开扩展入口。

## PowerShell 分版本语法指导（2026-10-09）

- 原生解析器选定 PowerShell 后执行无 profile 主版本查询，进程 timeout 5 秒、输出上限 1 KB；成功与失败均缓存于扩展实例，reload 后重新探测。
- 7+ 直接指导 && / ||，不包含 5.1 兼容限制；5.1 指导显式条件检查；失败明确版本未知并提供临时兼容指导。通用引用、对象 pipeline 和 rg 指导共用。
- 测试覆盖两套指导、未知版本、成功及失败缓存、异常/非法输出、非 Windows 不探测；实机 PATH 隔离验证 5.1 fallback 同时选择 5.1 指导。既有 profile、UTF-8 和执行行为回归保留。
- 自动验证：`npm run typecheck`、`npm test`（45 项）、`npm pack --dry-run` 通过。

## 原生 PowerShell 适配（2026-10-09）

- 移除自定义 pwsh 注册与 PowerShell 7 路径探测，Windows 同名适配原生 powershell；非 Windows 自动启用原生 bash。停用另一平台 shell 和旧 pwsh，保留 read/write、MCP 与其他扩展状态。
- 保留原生 UTF-8、参数、renderer、schema 与结构化结果；以 operations 前缀显式按标准顺序加载 profiles，并在 spawnHook 注入 TERM=dumb。兼容语法指导默认针对 5.1，明确限制 && / || 仅用于 7+。
- 自动测试覆盖平台选择、原生 metadata、调用时 cwd、环境、取消信号、流式更新、timeout 透传、非零退出结果；Windows 实机覆盖 7 与 5.1 的 profile 加载顺序及同作用域函数可用性，并隔离 PATH 验证原生 5.1 fallback 和中文 UTF-8 输出。测试使用临时 profiles，不改动用户配置。
- macOS/Linux 工具选择通过平台参数测试；非 Windows 实际 Bash 执行与交互 TUI 验收仍待对应设备。
- 自动验证：`npm run typecheck`、`npm test`（40 项）、`npm pack --dry-run` 通过；仍只有一个公开扩展入口。

## 移除 write 兼容覆盖（2026-10-09）

- Windows 实机运行 Bun `1.4.2`（`744846f84`），以 `attrib +R` 设置并确认目录只读属性；现有目录 recursive mkdir、创建子目录、直接写文件、pi `1.1.0` 原生 write 和增强 write 均成功，文件内容正确。Node `v26.11.1` 对照正常；未确定最早修复版本。
- 删除 write wrapper、入口注册和四项专用兼容测试；直接由 pi 提供原生 write。入口与激活测试覆盖不注册 write，以及保留原生 read/write 的启用和禁用状态。
- 下方旧版 write 补丁验收为历史记录，当前实现已移除该补丁。
- 自动验证：`npm run typecheck`、`npm test`（35 项）、`npm pack --dry-run` 通过；发布包不含 write wrapper，仍只有一个扩展入口。

## 移除读图兼容（2026-10-09）

- 删除 read 覆盖、vision 配置路由、嵌套视觉请求、进度 renderer 和专用测试；read 完全由 pi 原生工具接管。
- 删除 model_select 中的 read 重新注册；激活测试覆盖保留原生 read 的启用与禁用状态，入口测试覆盖不注册 read 且模型切换保留其他工具。
- 原 image.query/detail 和 vision 配置不再由本包提供；下方视觉回退验收仅为历史记录。
- 自动验证：`npm run typecheck`、`npm test`（39 项）、`npm pack --dry-run` 通过；发布包不含 read/vision 实现，仍只有一个扩展入口。

## pi 1.1.0 升级与内置 MCP 迁移（2026-10-09）

- 四个 pi 开发依赖锁定 `1.1.0`，peer dependencies 最低版本同步提升；对照本地 `../pi` 源码、changelog 和 npm 发布版本检查。
- 删除本包的 MCP config/client/search/call/renderer、直接 SDK 依赖和专用测试。包仍只暴露一个扩展入口；pi 内置 MCP 的传递依赖保留。
- 当前用户 `~/.pi/agent/mcp.json` 的两条配置符合内置格式，原文件直接由内置 MCP 接管，无需改写或搬移；settings 中没有禁用内置 MCP 的条目。项目迁移路径记录为 `.mcp.json` → `.pi/mcp.json`，本仓库没有待迁移项目配置。
- `pi mcp list` 实际确认 Exa HTTP 连接（2 tools）与 cua-driver stdio 连接（57 tools）成功，默认 exposure 均为 codemode。
- 增强 read 保留原生结构化输出；vision fallback 的成功、错误、取消终态均返回 codemode 可消费的文本，成功路径继续返回嵌套 usage；受控测试不访问模型或凭据。
- edit 的 schema、队列、BOM/CRLF、模糊匹配与部分成功算法仍兼容；原生 renderer 的实际 diff 回填、折叠/展开与 rejected-only 布局回归通过。备用警告渲染跟随新版 `outputPad`。
- shell 继续透传原生 `outputSchema` / `structuredContent` 和执行上下文，Windows PowerShell 7 实际执行测试通过；session info/title lifecycle 回归通过。上游 write 仍使用原来的 recursive mkdir，本包继续保留 EEXIST 目录确认补丁。
- 完整 SDK session 从用户现有本地 package 配置加载本包，同时加载内置 MCP/codemode/tool_search，无扩展加载错误；受控 assistant tool call 通过内置 codemode 发现 Exa namespace 并调用增强 read，结束时触发 shutdown 释放连接。未调用真实主模型。
- 自动验证：`npm run typecheck`、`npm test`（49 项）、`npm pack --dry-run` 通过。单入口及发布包无本包 MCP 模块；测试覆盖启动/模型切换保留内置 MCP 工具。
- 本轮没有重跑真实视觉模型或交互 TUI 目视验收；非 Windows 实机验收仍延期。下方旧版 MCP 验收仅为历史记录，相关代码和测试现已删除，不再作为本包验收项。

## pi 0.87.1 升级

- 四个 pi 开发依赖锁定 `0.87.1`，peer dependencies 最低版本同步提升。
- 对照本地 `../pi` 的 package manifests 与 changelog：本版主要更新模型目录、默认 xAI 模型及供应商兼容性；agent-core 与 tui 没有新增行为条目。原生工具契约未变。
- 自动验证通过：`npm run typecheck`、`npm test`（69 项）、`npm pack --dry-run`。真实模型与交互 TUI 验收尚未针对 `0.87.1` 重跑。

## pi 0.87.0 升级

- 四个 pi 开发依赖锁定 `0.87.0`，peer dependencies 最低版本同步提升。
- 对照本地 `../pi` 的 `0.87.0` package manifests 与 changelog 检查升级范围；重点回归 0.86.0/0.87.0 的工具 details JSON 类型约束、扩展 lifecycle 边界及按模型图片输入限制。
- 自动验证通过：`npm run typecheck`、`npm test`（58 项）、`npm pack --dry-run`。真实模型与交互 TUI 验收沿用下方既有状态，尚未针对 `0.87.0` 重跑。

## pi 0.85.1 升级

- 四个 pi 开发依赖锁定 `0.85.1`，peer dependencies 最低版本同步提升。
- 对照本地 pi 源码与 0.83.0 之后的 changelog 检查公开工具构造器、renderer、extension API 与模型认证 headers；模型请求继续原样透传 headers。
- 回归覆盖 edit 按执行上下文目录处理部分成功，以及原生 write 更新后的成功提示（不再报告字节数）。
- 自动验证通过：`npm run typecheck`、`npm test`（58 项）、`npm pack --dry-run`。

### 2026-09-05 真实模型验收

使用已安装的 pi `0.85.1` SDK、真实用户模型认证和当前扩展源码。测试文件与报告放在系统临时目录；不更改用户模型配置，会话使用 `SessionManager.inMemory()`。

- [x] 完整扩展加载到 SDK session，`ark-agent-plan/kimi-k3` 主模型实际调用增强 `read`，原生图片附件保留，正确识别测试图中的红色正方形、蓝色圆形与 `PI 851`。
- [x] 同一 session 切换到纯文本 `deepseek/deepseek-v4-flash`，实际调用 `read` 后按现有 vision 配置委托 `ark-agent-plan/kimi-k3`；工具返回纯文本、`delegated: true` 与 587 tokens 的嵌套 usage，主模型正确复述图像内容。
- [x] 独立调用增强 `read`，收到真实 vision 流式进度后触发主调用 AbortSignal，约 1 ms 返回 `cancelled`；结束后观察 400 ms，无残留进度更新。
- [x] 完整 SDK session 首轮生成并保存自动标题。另用受控生命周期事件与真实 Kimi 请求验收：请求尚未完成时手工设置标题，生成结果不覆盖；fork 追加 ` (1)`，且不新增模型请求。
- [x] 标题真实请求启动后触发 `session_shutdown`，请求以 `aborted` 结束，没有写入标题。SDK session 结束时触发 shutdown 并释放资源。

本轮是 SDK 端到端与真实请求验收，不包含交互 TUI 的目视检查；下方 MCP 交互验收及非 Windows 实机验收仍保留为延期项。

## 已完成验收

- [x] 在已认证的多模态主模型上验收原图片读取路径（现已合并为增强 `read`）。
- [x] 在纯文本主模型与已配置 vision 模型上验收 fallback、usage 与取消。
- [x] 在已认证的真实当前模型上验收首条消息异步命名、手工改名竞争与 fork 尾缀。
- [x] 单元测试覆盖 MCP 全局/项目配置覆盖、项目信任、固定搜索/调用工具、内部动态目录、调用参数、取消透传与连接清理。
- [x] 单元测试覆盖 stdio server `stderr` 隔离与有界诊断，避免子进程日志污染 Pi TUI。
- [x] 单元测试覆盖 MCP 多 block 总预算、超长单行 UTF-8 截断、完整文本落盘和 collapsed/expanded renderer。
- [x] 单元测试覆盖 session resume 的 MCP 历史 renderer placeholder 保持非激活并默认折叠。
- [x] 使用官方 SDK 实际连接 Exa Streamable HTTP（发现 2 个 tools）与 `@modelcontextprotocol/server-everything` stdio（发现 13 个 tools）。

## 延期验收

- [ ] 在非 Windows 平台实际执行原生 `bash` 路径。当前缺少相关设备，平台无关单元测试已覆盖；首次在其他平台使用时完成实机验收。
- [ ] 在 Pi 交互 session 中完成 MCP 工具调用和 `tools/list_changed` 人工验收。

延期项不阻塞 `0.1.0`。发布不创建 GitHub tag。

## MCP 懒加载升级（2026-09-22）

- [x] 单元测试覆盖静态服务器名称目录、关键词权重、分页浏览、精确 schema、超大单定义完整返回、跨 server 故障隔离和取消等待。

## MCP hint 清理（2026-09-23）

- [x] 移除 hint 配置和生成命令，并覆盖旧 `hint` 字段的严格校验错误；测试无需凭据或外部模型。
- [x] `npm run typecheck`、`npm test`（67 项）与 `npm pack --dry-run` 通过。

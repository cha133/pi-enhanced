# 验证状态

版本：`0.1.0`

最后更新：2026-09-22

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
- [x] 单元测试覆盖 MCP 全局/项目配置覆盖、项目信任、直接工具注册、动态目录、调用参数、取消透传与连接清理。
- [x] 单元测试覆盖 stdio server `stderr` 隔离与有界诊断，避免子进程日志污染 Pi TUI。
- [x] 单元测试覆盖 MCP 多 block 总预算、超长单行 UTF-8 截断、完整文本落盘和 collapsed/expanded renderer。
- [x] 单元测试覆盖 session resume 的 MCP 历史 renderer placeholder 保持非激活并默认折叠。
- [x] 使用官方 SDK 实际连接 Exa Streamable HTTP（发现 2 个 tools）与 `@modelcontextprotocol/server-everything` stdio（发现 13 个 tools）。

## 延期验收

- [ ] 在非 Windows 平台实际执行原生 `bash` 路径。当前缺少相关设备，平台无关单元测试已覆盖；首次在其他平台使用时完成实机验收。
- [ ] 在 Pi 交互 session 中完成 MCP 工具调用和 `tools/list_changed` 人工验收。

延期项不阻塞 `0.1.0`。发布不创建 GitHub tag。

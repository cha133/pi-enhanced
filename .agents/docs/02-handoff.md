# 跨会话交接

最后更新：2026-08-02

## 一句话目标

在空仓库 `pi-enhanced` 中开发一个只有一个公开扩展入口的 pi package：保留 pi 的极简工具哲学，并用 `pwsh`、部分成功的 `edit`、`view_image` 和 `subagent` 做合理增强。

## 用户已明确的需求

- pi 原生工具是 `bash`、`read`、`write`、`edit`。
- 增强模式禁用 `read`，覆盖 `edit`；Windows 且安装 PowerShell 7 时提供 `pwsh` 并禁用 `bash`，否则保留原生 `bash`。
- `pwsh` 参考 `../pi-extensions/extensions/bash.ts` 与 `shell-guidance.ts`，并把 guidance 集成到工具 prompt metadata 中。
- 因为没有 `read`，PowerShell guidance 必须教模型用 `Get-Content` 和 `Select-Object` 分段读取文本文件。
- `edit` 仍是 exact/fuzzy replace，沿用 pi 的 Unicode、换行、BOM 等处理；批量调用中，合法 edit 应落盘，失败 edit 返回给模型重试。
- `view_image` 对多模态模型直接提供图片，对纯文本模型自动调用配置的 vision 模型；fallback 模型回复过程要对用户实时可见。
- 移植 `pi-extensions` 的 `subagent`；模型配置与 `vision` 同处顶层，使用 `advisor` 而不是 `subagent.advisor`。
- 当前阶段只写 `.agents/docs/`，写完后继续在文档上对齐。

## 2026-08-02 已追加确认

- 单入口允许导入内部模块。
- 所有平台始终禁用 `read`。没有 pwsh 7 时静默保留并覆盖原生 `bash`，为它补充 bash 文本读取与分页 guidance。
- `view_image` 使用 `path`、可选 `query`、可选 `detail`；多模态模型原生消费 image content，纯文本模型明确知道结果来自外挂 vision 模型。工具 prompt metadata 随当前模型能力刷新。
- vision fallback 失败返回清晰普通结果，不抛工具错误。
- subagent 完整保留 peer/advisor tier，只有 advisor 模型配置扁平化为顶层 `advisor`；子 agent 继承运行平台的有效主工具集。
- 包名 `pi-enhanced`，MIT，仅通过 GitHub 安装；当前开发版 `0.0.1`，完成后发布 `0.1.0`，最低支持 pi `0.83.0`。
- edit 的重叠组全部拒绝，其他正确项合并成一次原子写盘；rejected 项只返回索引、错误和明确标注为不完整的有界预览。
- vision fallback 沿用 `pi-extensions` read/subagent 风格，在 TUI 显示紧凑单行实时状态。
- `view_image.detail` 只控制分析深度；图片统一沿用 pi 的自动等比缩放，不提供原始分辨率开关。
- pwsh 7 加载用户 profile，并注入 `TERM=dumb`，与目标 Codex exec_command 体验对齐。

## 已核实的实现事实

- 当前相邻 `../pi` 版本为 `0.83.0`。
- pi 可用 `pi.registerTool()` 同名覆盖内置工具，用 `pi.getActiveTools()` / `pi.setActiveTools()` 移除或加入有效工具。
- pi 的 override 不继承 prompt metadata；未提供 renderer 时可按槽位继承内置 renderer。
- pi 内置 edit 在同一个原始文件快照上匹配所有 replacements，支持 LF 统一、BOM 恢复、NFKC/引号/破折号/尾随空白归一化，并在任何 edit 出错时全量拒绝。
- `pi-extensions` 的 vision fallback 使用 `@earendil-works/pi-ai` 的 `stream()`，通过 `onUpdate` 限流发布 thinking/reply 状态，并返回嵌套调用 usage 的设计可复用。
- `pi-extensions` subagent 默认 peer 使用当前模型，advisor 仅在配置且不同于当前模型时暴露；子会话会转发紧凑状态、导出 transcript、传播取消并清理 session。

## 当前建议（尚未全部确认）

- 一个公开入口 `extensions/pi-enhanced.ts`，内部可拆到 `extensions/lib/`；package manifest 只列出该入口。
- 在 `session_start` 统一注册工具并计算有效工具集；在 `model_select` 只刷新与模型能力/schema 有关的工具。
- `read` 始终禁用，因为 `pwsh`/fallback bash 承担文本读取，`view_image` 承担图片读取。
- `edit` 先对原始快照独立分类；重叠组全部拒绝，对其余 accepted edit 一次写盘；结果返回原输入索引的 applied/rejected 列表与有界错误预览。
- `view_image` 原生路径返回 image content；fallback 路径返回 vision 文本和 usage。
- 配置采用顶层 `vision` 与顶层 `advisor`；peer 始终继承当前模型，不再配置。

## 当前实现状态

- package 仅公开 `extensions/pi-enhanced.ts`，内部实现位于 `extensions/lib/`。
- 已实现 activation、shell、edit、view_image、settings 与 subagent。
- 子 agent 不递归加载公开入口，而由隐藏 inline child extension 注册同平台 shell、write、enhanced edit 与 view_image；明确排除 subagent。
- 测试覆盖激活集合、pwsh 7 探测和真实执行、fallback bash guidance、edit 分类/重叠/fuzzy/BOM/CRLF、配置合并、动态 view prompt、vision/subagent 状态归约和单入口注册。
- `npm run typecheck`、`npm test`、`npm pack --dry-run` 和 `npm audit --omit=dev` 已通过。

## 下一步

用真实已认证模型分别验收多模态 view_image、纯文本 vision fallback、peer/advisor subagent。验收完成后修复问题并 bump `0.1.0`。

## 关键参考

- pi 内置 edit：`../../../pi/packages/coding-agent/src/core/tools/edit.ts`
- pi edit 匹配算法：`../../../pi/packages/coding-agent/src/core/tools/edit-diff.ts`
- pi 内置 bash：`../../../pi/packages/coding-agent/src/core/tools/bash.ts`
- pi 扩展 API：`../../../pi/packages/coding-agent/docs/extensions.md`
- PowerShell override：`../../../pi-extensions/extensions/bash.ts`
- shell guidance：`../../../pi-extensions/extensions/shell-guidance.ts`
- vision fallback：`../../../pi-extensions/extensions/lib/read.ts`
- subagent：`../../../pi-extensions/extensions/subagent.ts`
- Codex PowerShell safe commands：`../../../codex/codex-rs/shell-command/src/command_safety/windows_safe_commands.rs`

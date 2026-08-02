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
- `read` 始终禁用，因为 `pwsh`/fallback bash 承担文本读取，`view_image` 承担图片读取。此点需用户确认。
- `edit` 先对原始快照独立分类，再剔除相互重叠项，对所有 accepted edit 一次写盘；结果返回原输入索引的 applied/rejected 列表。
- `view_image` 原生路径返回 image content；fallback 路径返回 vision 文本和 usage。
- 配置暂定：顶层 `vision` 与顶层 `advisor`；peer 始终继承当前模型，不再配置。

## 下一步

先与用户逐项确认 [13-configuration-and-decisions.md](./13-configuration-and-decisions.md) 的开放问题，再更新文档状态；未对齐前不要创建实现代码。

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


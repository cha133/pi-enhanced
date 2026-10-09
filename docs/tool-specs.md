# 工具行为契约

## `write`

### 临时兼容覆盖

- 保持 pi 1.1.0 原生 `write` 的输入 schema、路径解析、mutation queue、取消检查、UTF-8 完整写入、返回文本和 TUI renderer；成功提示为 `Successfully wrote to <path>`，不报告字节数。
- 只替换本地 `mkdir` / `writeFile` operations；父目录仍使用 recursive mkdir 创建。
- 若 recursive mkdir 抛出 `EEXIST`，必须再以 `stat` 确认该路径确实是目录才继续写入。路径是文件、无法确认或任何其他错误均原样失败。

此覆盖专门规避 Bun 在 Windows 上对带只读属性的现有目录执行 recursive mkdir 时错误抛出 `EEXIST`。这是临时修复；升级 pi 或 Bun 时应先回归该场景，确认上游已修复后删除增强 `write`、注册代码与对应兼容测试，恢复原生工具。

## `pwsh`

### 可用条件

仅当同时满足以下条件时注册并启用：

- `process.platform === "win32"`；
- 能解析到 `pwsh.exe`；
- 沿用 `pi-extensions` 的路径探测：检查 `PATH` 与常见 PowerShell 7 安装位置是否存在 `pwsh.exe`，不在 pi 启动期运行它。

不满足时不报错、不提示，保留用户原有的 pi `bash` 状态；入口仍用同名 override 保留原生执行并补充通用 shell/ripgrep guidance。

### 输入与执行

保持 pi bash 的输入形状，仅把名字和描述改为 PowerShell：

```ts
{
  command: string;
  timeout?: number; // 秒
}
```

- cwd 为当前 session cwd。
- 使用 PowerShell 7，不使用 Windows PowerShell 5.1。
- 复用 pi 的 streaming、timeout、abort、process-tree kill 与 truncation。
- 加载用户 `$PROFILE` 并注入 `TERM=dumb`，减少遵循该环境标记的 profile 交互初始化和命令 ANSI 输出；行为用测试固定。

### Prompt guidance

工具自身的 `promptGuidelines` 同时承载 shell 语法与工作流指导，不再另设修改 system prompt 的 shell-guidance 扩展：

- 明示工具运行 PowerShell 7，不是 bash/sh。
- 环境变量使用 `$env:NAME`，路径检查使用 `Test-Path`，带空格的可执行路径用调用运算符 `&`。
- 后续命令依赖前一步成功时使用 `&&`，失败处理使用 `||`；仅在后续命令必须无条件执行时使用 `;`。验证与破坏性修改不得用 `;` 串联，多步骤修改改用显式检查或 fail-fast 临时脚本。
- 优先单引号表达字面量；说明双引号插值与反引号转义。
- 不使用 `Invoke-Expression` 拼装整条命令。
- PowerShell pipeline 传对象；限制输出用 `Select-Object -First N` / `-Last N`。
- 文件发现优先 `rg --files`，内容搜索优先 `rg -n`；禁止误用 `rg -r`。
- Windows 下用 `rg` 按文件名过滤时，PATH 只传目录（或 `.`），筛选用 `--glob`（如 `rg -n PATTERN dir --glob '*.go'` / `--glob '!*_test.go'`）；禁止写 `dir/*.go` 这类 shell 通配路径——pwsh 常原样传给 `rg`，而 Windows 路径不允许 `*`。
- 非平凡分支、循环、结构化处理转为 `$env:TEMP` 下的临时 TypeScript，并用 Bun 执行。

### fallback `bash` guidance

非 Windows 或 Windows 无 pwsh 7 时，工具名仍为 `bash`，执行行为完全沿用 pi；override 只显式保留原 prompt metadata 并加入：

- 文件发现与内容搜索仍优先 `rg --files` / `rg -n`。
- 限制搜索或命令输出优先使用命令自身的 limit 参数，再考虑 `head` / `tail`。
- 复杂逻辑转到系统临时目录中的 TypeScript/Bun 脚本；临时目录使用跨平台可解析方式，不在仓库遗留脚本。

## `edit`

### 输入

沿用 pi 1.1.0 的批量 schema：

```ts
{
  path: string;
  edits: Array<{
    oldText: string;
    newText: string;
  }>;
}
```

保留旧 session 的 top-level `oldText` / `newText` 参数迁移可作为兼容项，但不出现在公开 schema。

### 匹配语义

- 所有 edit 都相对于调用开始时的同一原始内容匹配，不增量匹配。
- 输入换行统一为 LF；写回时恢复原文件主要换行风格与 BOM。
- 先 exact match，必要时沿用 pi 的 fuzzy normalization（包括 Unicode NFKC、智能引号/破折号与尾随空白处理）。
- `oldText` 必须非空且在匹配空间中唯一。
- `newText === oldText` 或最终没有变化视为该项 rejected。
- 不允许 accepted edits 的目标范围重叠。

### 部分成功算法

1. 在文件 mutation queue 内读取一次原文件。
2. 对每个 edit 独立计算候选匹配，记录原始数组索引。
3. 将空 oldText、not found、duplicate、no-op 标为 rejected，其余成为候选。
4. 候选按文件位置排序并检测重叠。
5. 重叠组全部拒绝，避免依赖数组顺序悄悄选择赢家；不冲突候选保持 accepted。
6. 对 accepted 候选按逆序一次性应用并一次写盘。这里“每条正确项单独落盘”指独立决定成功与否，不是执行多次物理写入。
7. 若 accepted 为空，不写文件，返回完整 rejected 信息。
8. 文件 access/read/write/abort 属于调用级错误，直接抛出；参数级错误不抛出。

这里的“部分成功”以单次文件写入为提交边界：参数错误可局部失败，I/O 错误不可局部成功。

### 返回

模型可见文本简洁列出：

```text
Applied 2 of 4 replacements to src/example.ts.
Rejected edits:
- edits[1]: oldText was not found. Preview: "first bounded line … last bounded line"
- edits[3]: overlaps edits[2]; neither overlapping replacement was applied.
```

模型已经能看到同一 tool call 的完整输入，因此结果不重复完整 `oldText` / `newText`。每条 rejected 返回原索引、错误信息和有字符/行数上限的预览；预览必须含 `truncated: true`、`omittedLines` 等明确元数据，只用于定位，不能伪装成可复制重试的完整参数。details 同样不保留完整 rejected 原参数，避免无谓增加 session 体积。

details：

```ts
{
  diff: string;
  patch: string;
  firstChangedLine?: number;
  applied: Array<{ index: number }>;
  rejected: Array<{
    index: number;
    reason: "empty" | "not_found" | "duplicate" | "overlap" | "no_change";
    message: string;
    conflictsWith?: number[];
  }>;
}
```

只要工具成功完成分类（即使 applied 为 0），结果都不是 tool error；模型依据 rejected 修正后只重提失败项。

### 渲染

- 复用 pi 原生 edit 的 self-rendered box、路径显示、调用期 diff 预览、背景状态和组件复用；普通全成功调用保持原生布局，不额外显示成功摘要。
- 结果落定后把实际落盘 diff 回填到调用区域；部分成功时以实际 diff 替换可能基于完整输入产生的调用期预览或预检错误。
- 部分成功使用成功/警告语义，不显示成全红失败；警告放在原生 edit 调用框内、实际 diff 下方。
- rejected-only 结果复用原生调用框的 header/body 间距，不渲染空 diff 行或框外空行。
- rejected 摘要在折叠视图仅显示 applied/rejected 数量和 `Ctrl+O` 提示，expanded 展示每项索引、reason code 与原因。

## `read`

本包不再覆盖 `read`，直接使用 pi 1.1.0 原生工具，并保留用户现有的启用/禁用状态。

### 输入

```ts
{
  path: string;
  offset?: number;
  limit?: number;
}
```

- schema、路径解析、调用时 cwd、文本分页、50 KB / 2,000 行截断、错误、取消与 renderer 均由 pi 管理。
- 本地图片读取、MIME 判断和自动缩放沿用 pi 设置及当前模型的图片输入限制；图片以附件交给当前模型查看。
- 保留原生 `outputSchema` 和 `structuredContent`：文本为字符串，图片为含 `type/data/mimeType/note` 的对象，供 codemode 使用。
- 不检查模型能力以委托视觉模型，不读取 `vision` 配置，不发起嵌套模型请求或显示委托进度。
- 移除原扩展的 `image.query/detail` 参数；不增加 hashline 或单独的 `view_image` 工具。
- 对不支持图片的模型，沿用 pi 原生提示和请求处理行为，不再提供兼容读图。

## MCP

MCP 配置、发现、调用、取消、连接清理及渲染均由 pi 内置 MCP 扩展负责。本包不注册 MCP 工具或历史 renderer placeholder。工具激活必须保留现有的 codemode、tool_search 和 MCP 工具。

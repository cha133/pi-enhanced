# 工具行为契约

## `write`

### 原生工具

- 直接使用 pi 1.1.0 原生 `write`，本包不注册覆盖，不注入本地 operations，保留其现有启用或禁用状态。
- 输入 schema、路径解析、mutation queue、取消检查、父目录创建、UTF-8 完整写入和 TUI renderer 均由 pi 管理；成功提示为 `Successfully wrote to <path>`，不报告字节数。

2026-10-09 在 Windows 上使用 Bun `1.4.2` 实测：带只读属性的现有目录 recursive mkdir 和 pi 原生 write 均成功，未复现原 `EEXIST` 问题，已移除临时兼容覆盖。

## Shell：`powershell` / `bash`

### 平台与激活

- Windows 同名适配 pi 1.1.0 原生 `powershell` 并启用它，移除 active set 中的 `bash` 和旧 `pwsh`。
- macOS/Linux（及其他非 Windows 平台）同名适配并启用原生 `bash`，移除 active set 中的 `powershell` 和旧 `pwsh`。
- 每次 session_start 基于现有 active set 计算，只调整接管的 shell 与 edit，保留 read/write 状态以及其他扩展、MCP、codemode 工具。
- 不再探测 PowerShell 7 安装位置或注册自定义 `pwsh`。初始化时通过原生解析器在 PATH 优先选择 `pwsh.exe`，找不到则选择 `powershell.exe`；选定的可执行文件及启动参数与版本一起缓存，后续调用固定使用该文件，不再次搜索 PATH 或静默切换。两者均缺失时返回原生查找错误，不切回 Bash；reload 后重新解析。
- 平台选择覆盖先前 shell 的禁用状态。pi 的用户 `!` / `!!` 命令仍由 Bash 执行。

### 输入、执行与 profile

沿用原生 `{ command: string; timeout?: number }`（timeout 单位秒）、outputSchema、structuredContent、调用时 cwd、streaming、timeout、abort、进程树终止、输出截断和 renderer。

Windows 使用 `createPowerShellToolDefinition`；因原生 `createLocalPowerShellOperations` 不支持固定路径且每次调用重新查找，operations 使用以 pi 1.1.0 原生进程执行实现为来源的最小适配，绑定初始化选定的可执行文件。保留原生 `-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command` 参数和 UTF-8 初始化，在同一命令作用域中依次 dot-source 存在的标准 profile：AllUsersAllHosts、AllUsersCurrentHost、CurrentUserAllHosts、CurrentUserCurrentHost。缺失 profile 跳过；profile 的输出和错误遵循 PowerShell 原生语义。进程启动前注入 `TERM=dumb`，profile 初始化可看到此环境变量；不修改用户 profile 或 settings。

### Prompt guidance

原生 `powershell` 的指导只有 PI_* 环境信息。本包保留其 metadata 并补充：

- description、promptSnippet 与 promptGuidelines 明示当前会话选定的实际版本；description 同时显示执行路径，不再描述“可能回退到 5.1”。版本未知时明确未知，不伪称 5.1。环境变量使用 `$env:NAME`，路径检查用 `Test-Path`，引用的可执行路径用 `&`。
- Windows 初始化时通过原生 `getPowerShellConfig()` 选择可执行文件，并用原生无 profile 参数查询 `$PSVersionTable.PSVersion.Major`。查询进程 timeout 为 5 秒，限制输出为 1 KB，不加载 profile、不显示窗口；可执行文件、参数、版本及失败均在扩展实例内缓存，reload 后重新探测，非 Windows 不探测。
- 确认 7+ 时明确指导 `&&` 成功依赖链与 `||` 失败处理，不附加 5.1 兼容限制。
- 确认 5 时明确禁止 `&&` / `||`，指导立即检查 `$?` 或原生命令的 `$LASTEXITCODE`，以显式 if/throw/exit 控制后续步骤；`$ErrorActionPreference='Stop'` 不能可靠处理原生命令失败。
- 版本查询失败或无法识别时仍固定使用已选定的可执行文件，不阻断工具注册，明确版本未知，暂用兼容指导，允许模型确认版本后采用对应语法；引用、pipeline 与 rg 搜索指导两套共用。
- `;` 仅连接无条件步骤，验证与破坏性修改不能以 `;` 串联。
- 单引号字面量、双引号插值、反引号转义、合法多行 here-string、对象 pipeline 与 `Select-Object` 限制输出；不使用 `Invoke-Expression` 拼装整条命令。
- `command` 是 JSON 解码后的 PowerShell 源码，JSON 只编码一次；明确区分传输层的 `\"` 与源码中的双引号，禁止用 Bash/C 风格 `\"` 转义 PowerShell 引号或再包一层 `pwsh -Command`。单引号内部用 `''`，双引号内部用反引号转义，并提供实际可执行例子。
- 嵌套插值先计算或用 `-f` 格式化；复杂代码用原生 write 写入临时脚本再执行，文件内容优先 read/write/edit，避免内联 `bun -e` / `python -c` 的多层引用。原生命令参数传递是另一层引用，5.1 与 7 的行为不同，源码正确不保证内嵌引号原样传递。
- 破坏性文件操作前在同一 PowerShell 作用域中验证最终绝对路径属于用户授权目录，拒绝空路径、盘符/共享根目录与意外目标；验证失败显式 throw，使用 `Remove-Item` / `Move-Item -LiteralPath -ErrorAction Stop`，不跨 shell 删除。引号不能关闭 `-Path` 通配符；引用/解析错误后先检查源码，不用破坏性命令试错。这些是模型指导，不是执行器的强制安全边界。
- 搜索优先 `rg --files` / `rg -n`，禁止误用 `rg -r` / `rg -rn`。Windows 文件名筛选使用目录 PATH 与 `--glob`，不要将 `dir/*.go` 等 shell 通配路径传给 rg。
- 非平凡分支、循环或结构化处理转为仓库外临时 TypeScript/Bun 脚本。

非 Windows 的 bash 保留原生执行与 metadata，仅添加通用 rg 搜索和临时 TypeScript/Bun 工作流指导。

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

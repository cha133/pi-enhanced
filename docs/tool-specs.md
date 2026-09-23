# 工具行为契约

## `write`

### 临时兼容覆盖

- 保持 pi 0.87.0 原生 `write` 的输入 schema、路径解析、mutation queue、取消检查、UTF-8 完整写入、返回文本和 TUI renderer；成功提示为 `Successfully wrote to <path>`，不报告字节数。
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

沿用 pi 0.87.0 的批量 schema：

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

### 输入

schema：

```ts
{
  path: string;
  offset?: number;
  limit?: number;
  image?: {
    query?: string;
    detail?: "brief" | "standard" | "detailed";
  };
}
```

- `path`、`offset`、`limit` 完全沿用 pi 0.87.0 原生 `read` schema 与语义。
- `image.query` 缺省为准确描述图片；用户有具体问题时模型应原样传达重点。
- `image.detail` 控制 fallback system prompt 的深度，也可作为给原生模型的文字提示。
- 文本结果保持原生内容、分页提示、50 KB / 2,000 行截断、错误和 renderer；不增加 hashline 标签、行锚点或 session grounding。

### 原生多模态路径

若当前模型声明 image input：

- 复用 pi 的本地图片读取、MIME 判断和自动等比缩放，不裁切。默认遵循 pi 设置：最大 2000×2000，并将 base64 payload 控制在约 4.5 MB 内。
- 返回 image content（以及必要的 query text），让当前模型在下一轮原生消费。
- 不发起第二次模型调用。
- 工具 description/guidelines 明确说明图片由当前模型亲自查看；调用与结果继续使用原生 `read` renderer。

### 纯文本 fallback 路径

若当前模型不支持 image input：

1. 读取顶层 `vision` 配置并解析已注册模型。
2. 验证 fallback 模型声明 image input，并获取认证信息；发送与原生路径相同的预处理图片。
3. 调用 `stream()`，消息包含 query 与 image content。
4. 把 `start`、`thinking_delta`、`text_delta` 归约成用户可见的单行状态，经 `onUpdate` 约 100 ms 限流发布；流式阶段使用 `reasoning: `、`replying: ` 等小写前缀，终态使用 `finished · MODEL`。
5. 最终只把 vision 模型文本回复返回给主模型，并按 pi 上限截断；文本文件读取绝不触发 vision fallback。
6. 返回嵌套模型 usage；传播 abort。

工具 description/guidelines 明确说明当前模型不能直接看图，`read` 会调用外挂 vision 模型，返回值是该模型的视觉描述而非当前模型的直接观察。

“实时看到回复”指 TUI 中持续更新一行最新 thinking/reply 摘要，不把完整中间 token stream 永久写入 transcript。

### 错误

- 路径、格式或读取失败：沿用原生 `read` 行为；无法处理成 image content 时不错误触发 fallback。
- 缺少/错误 vision 配置、模型不支持图片、认证或 provider 错误：返回 `[Vision fallback failed: ...]` 普通文本结果，让主模型能解释或恢复。
- fallback 最终没有文本：同上。

## MCP 懒加载工具

### 固定工具面与静态目录

- 模型只看到 `mcp_search` 与 `mcp_call`，不再把每个 MCP tool 注册为 Pi tool。
- `session_start` 等待本地配置读取完成，按 server 名固定排序，将名称放入 `mcp_search` description。不读服务器自带简介，不自动调用模型，不维护独立简介缓存。
- 目录是当前 session 启动快照。连接顺序、连接成功与否、`tools/list_changed` 都不改变当前工具定义或 prompt。配置变更在下次 session 初始化（包括 `/reload`）时生效。
- SDK 仍异步导入；server 在后台并行连接，启动读取本地配置后无需等待网络或子进程握手。每个连接与首次目录发现最多等待 30 秒。
- 固定工具加入现有 active set，保留其他扩展工具。历史 `mcp_<server>_<tool>` 只注册非激活 renderer placeholder，继续支持 resume 时的折叠显示，不重新暴露旧工具。

### `mcp_search`

```ts
{
  server?: string;
  query?: string;
  tool?: string;
  full?: boolean;
  limit?: number; // 1–50；关键词搜索默认 5，其余默认 20
  offset?: number; // 默认 0
}
```

- 空参数：分页列出配置中的服务器名称和运行状态（connecting / ready / failed / closed）。
- `server`：分页浏览该服务器工具名和最多 240 字符的简介，不含 schema。
- `query`：搜索指定服务器或全部服务器，默认返回匹配项的完整工具定义；`full: false` 可请求轻量结果。
- `server + tool`：精确读取一个完整定义，必须指定 server；不要求每次 call 前都重复 search。
- `full: true`：显式请求完整定义，可配合无关键词浏览整个目录。
- 本地检索按工具名、title、description 和顶层参数名加权；支持大小写归一、下划线/标点与 camelCase 拆词，精确工具名优先，多关键词宽松匹配。无 BM25、向量服务或额外模型请求。跨语言/同义词不保证命中，工具指导优先英文关键词，换词或省略 query 浏览兜底。
- 返回 `total` 和可选 `nextOffset`。工具页约 24 KB，按完整条目切分；单个超大定义仍完整返回，不裁断 schema。浏览摘要可以缩短描述，完整模式保留 SDK 返回的工具定义。
- 精确服务器请求等待该服务器完成发现；跨服务器查询并行等待，对失败项返回 `unavailable`，不丢失健康服务器结果。调用者取消只取消当前等待，不关闭共享连接。

### `mcp_call`

```ts
{
  server: string;
  tool: string; // MCP 原始工具名
  arguments: Record<string, unknown>;
}
```

- 从最新内部目录查找工具，以 Pi 的 `validateToolArguments` 验证/规范化原始 JSON Schema 参数，再通过发现工具的同一 SDK client 调用。
- SDK 校验结构化输出时，忽略服务器 schema 中仅用于数字字段的 `format` 注解（例如 `uint64`）；保留原始目录/schema 及类型、范围等实际约束。这样 AJV 不会把未知数字格式的编译警告写入 TUI。
- 未知 server/tool 或错误参数返回明确错误，不发送调用；目录变动后的旧工具名提示重新 search。
- 父调用 `AbortSignal` 传给 SDK `callTool()`，由 SDK 执行对应 transport 的取消语义。
- MCP text/image 直接映射为 Pi text/image。embedded text resource 附 URI；resource link 返回名称、描述与 URI；audio/binary resource 只返回类型/大小说明。
- `structuredContent` 仅在没有原生 text/resource text 时序列化；details 不重复保存完整结构。MCP `isError` 转成 Pi tool error。
- 所有返回 text blocks 合并共享 50 KB / 2,000 行总预算，超长单行保留 UTF-8 安全前缀。超限完整文本写入系统临时目录 `pi-mcp-*/output.txt`（mode `0600`），结果显示统计和路径；图片不计入文本预算。
- details 保留 server、tool、可选 truncation 统计和完整文本路径。TUI 折叠最多 3 行/约 800 源字符；JSON 可紧实显示，展开保留原格式且不绕过输出硬上限。自定义调用标题始终显示 `mcp_call <server> / <tool>`，折叠、执行中、成功/错误及历史回放都可辨认目标；参数流尚未到达时以 `…` 占位。

### 内部目录与连接

- `tools/list_changed` 只更新内存中的完整目录，不改变 Pi 工具集合。
- 使用 SDK 的聚合分页发现、协议握手和 transport 生命周期，不自行实现 MCP 协议。
- stdio `stderr` 由扩展 pipe 并持续消费，正常诊断静默；连接失败只附最近 8,192 字符。
- session shutdown 取消尚未完成的连接并关闭所有 client/transport。

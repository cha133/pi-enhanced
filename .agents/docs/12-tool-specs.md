# 工具行为契约

## `pwsh`

### 可用条件

仅当同时满足以下条件时注册并启用：

- `process.platform === "win32"`；
- 能解析到 `pwsh.exe`；
- 真实启动验证其 `$PSVersionTable.PSVersion.Major -ge 7`。

不满足时不报错、不提示，保留用户原有的 pi `bash` 状态；入口仍用同名 override 保留原生执行并补充 bash 文件读取 guidance。

### 输入与执行

建议保持 pi bash 的输入形状，仅把名字和描述改为 PowerShell：

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
- 优先单引号表达字面量；说明双引号插值与反引号转义。
- 不使用 `Invoke-Expression` 拼装整条命令。
- PowerShell pipeline 传对象；限制输出用 `Select-Object -First N` / `-Last N`。
- 文件发现优先 `rg --files`，内容搜索优先 `rg -n`；禁止误用 `rg -r`。
- 文本文件完整读取使用 `Get-Content -LiteralPath 'path'`；需要原始单字符串时用 `-Raw`。
- 分段读取建议：`Get-Content -LiteralPath 'path' | Select-Object -Skip <zero-based> -First <count>`。
- 读取指定行区间时明确 `-Skip` 为零基跳过数量，而用户/编辑器行号通常从 1 开始。
- 非平凡分支、循环、结构化处理转为 `$env:TEMP` 下的临时 TypeScript，并用 Bun 执行。
- 不为简单读取生成脚本；`Get-Content` / `rg` 足够时保持直接。

### fallback `bash` guidance

非 Windows 或 Windows 无 pwsh 7 时，工具名仍为 `bash`，执行行为完全沿用 pi；override 只显式保留原 prompt metadata 并加入：

- 文件发现与内容搜索仍优先 `rg --files` / `rg -n`。
- 小文件可用 `cat -- path`；不得无界输出未知大小文件。
- 分段读取用 `sed -n '<start>,<end>p' -- path`，其中行号从 1 开始且区间包含两端。
- 从某行开始读取固定数量可用 `tail -n +<start> -- path | head -n <count>`。
- 限制搜索或命令输出优先使用命令自身的 limit 参数，再考虑 `head` / `tail`。
- 复杂逻辑转到系统临时目录中的 TypeScript/Bun 脚本；临时目录使用跨平台可解析方式，不在仓库遗留脚本。

## `edit`

### 输入

沿用 pi 0.83.0 的批量 schema：

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

建议 details：

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

- 有 applied 时显示实际落盘 diff，而不是完整输入的预览 diff。
- 部分成功使用成功/警告语义，不显示成全红失败。
- rejected 摘要在折叠视图保持紧凑，expanded 可展示逐项原因。

## `view_image`

### 输入

建议 schema：

```ts
{
  path: string;
  query?: string;
  detail?: "brief" | "standard" | "detailed";
}
```

- `path` 支持 cwd 相对路径和绝对路径。
- `query` 缺省为准确描述图片；用户有具体问题时模型应原样传达重点。
- `detail` 控制 fallback system prompt 的深度，也可作为给原生模型的文字提示。

### 原生多模态路径

若当前模型声明 image input：

- 复用 pi 的本地图片读取、MIME 判断和自动等比缩放，不裁切。默认遵循 pi 设置：最大 2000×2000，并将 base64 payload 控制在约 4.5 MB 内。
- 返回 image content（以及必要的 query text），让当前模型在下一轮原生消费。
- 不发起第二次模型调用。
- 工具 description/guidelines 明确说明图片由当前模型亲自查看。

### 纯文本 fallback 路径

若当前模型不支持 image input：

1. 读取顶层 `vision` 配置并解析已注册模型。
2. 验证 fallback 模型声明 image input，并获取认证信息；发送与原生路径相同的预处理图片。
3. 调用 `stream()`，消息包含 query 与 image content。
4. 把 `start`、`thinking_delta`、`text_delta` 归约成用户可见的单行状态，经 `onUpdate` 约 100 ms 限流发布。
5. 最终只把 vision 模型文本回复返回给主模型，并按 pi 上限截断。
6. 返回嵌套模型 usage；传播 abort。

工具 description/guidelines 明确说明当前模型不能直接看图，`view_image` 会调用外挂 vision 模型，返回值是该模型的视觉描述而非当前模型的直接观察。

“实时看到回复”指沿用 `pi-extensions` read vision 与 subagent 的显示方式：TUI 中持续更新一行最新 thinking/reply 摘要，不把完整中间 token stream 永久写入父 transcript。

### 错误

- 路径、格式或读取失败：抛出工具错误。
- 缺少/错误 vision 配置、模型不支持图片、认证或 provider 错误：建议返回 `[Vision fallback failed: ...]` 普通文本结果，让主模型能解释或恢复。
- fallback 最终没有文本：同上。

## `subagent`

### 基本行为

- 工具名 `subagent`，`executionMode: "parallel"`。
- 参数至少包含 `title`、`task`；advisor 可用时增加可选 `tier: "peer" | "advisor"`，默认 peer。
- peer 始终继承当前主模型、thinking level、cwd 与 project trust。
- advisor 使用顶层 `advisor` 配置，且仅在模型存在并不同于主模型时暴露。
- 子任务必须自包含，并明确是否授权修改文件。
- 子 agent 不得再调用 `subagent`。

### 生命周期与输出

- 直接通过 pi SDK 创建隔离的内存 session，并绑定所需扩展。
- 子 session 工具集合必须在编码前定案；原则上与父 session 的有效增强工具面一致，但排除 `subagent`。
- 将 reasoning、tool activity、reply 归约为紧凑状态，通过 `onUpdate` 展示。
- 只把 final report 返回主模型；完整 JSONL transcript 存系统临时目录，路径作为内部审计元数据。
- 传播 abort；无论成功、失败或取消，都 unsubscribe、导出 transcript、abort、发 shutdown、dispose。
- 汇总并返回嵌套 usage。

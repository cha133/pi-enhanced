# 工具行为契约

## `write`

### 临时兼容覆盖

- 保持 pi 0.83.0 原生 `write` 的输入 schema、路径解析、mutation queue、取消检查、UTF-8 完整写入、返回文本和 TUI renderer。
- 只替换本地 `mkdir` / `writeFile` operations；父目录仍使用 recursive mkdir 创建。
- 若 recursive mkdir 抛出 `EEXIST`，必须再以 `stat` 确认该路径确实是目录才继续写入。路径是文件、无法确认或任何其他错误均原样失败。
- 主 session 与 subagent 使用同一增强定义。

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
- 部分成功使用成功/警告语义，不显示成全红失败；警告放在原生 diff 下方。
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

- `path`、`offset`、`limit` 完全沿用 pi 0.83.0 原生 `read` schema 与语义。
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

“实时看到回复”指沿用 `pi-extensions` read vision 与 subagent 的显示方式：TUI 中持续更新一行最新 thinking/reply 摘要，不把完整中间 token stream 永久写入父 transcript。

### 错误

- 路径、格式或读取失败：沿用原生 `read` 行为；无法处理成 image content 时不错误触发 fallback。
- 缺少/错误 vision 配置、模型不支持图片、认证或 provider 错误：返回 `[Vision fallback failed: ...]` 普通文本结果，让主模型能解释或恢复。
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
- 子 session 工具集合由父子共用的 child-safe surface 定案；新增普通增强编码工具只登记一次。child 继承父 session 当前 shell 的启用状态，但不反射复制第三方扩展工具。
- `subagent` 同时从 child 激活策略中移除，并通过 SDK `excludeTools` denylist 禁用；子 agent 即使未来调整共享注册逻辑也不能递归 delegation。
- 将 reasoning、tool activity、reply 归约为紧凑状态，通过 `onUpdate` 展示；阶段使用小写前缀，终态显示 `finished · MODEL`。
- 只把 final report 返回主模型；完整 JSONL transcript 存系统临时目录，路径作为内部审计元数据。
- 传播 abort；无论成功、失败或取消，都 unsubscribe、导出 transcript、abort、发 shutdown、dispose。
- 汇总并返回嵌套 usage。

## MCP 直接工具

### 暴露与命名

- 每个 `tools/list` 结果直接注册为独立 Pi tool，不提供额外的 `mcp` 代理或 list/search tool。
- 工具名为 `mcp_<规范化 server 名>_<规范化 tool 名>`，只保留字母、数字、下划线与连字符，最长 64 字符；截断和冲突后缀保持 session 内稳定。
- tool description 标明来源 server，并保留 MCP tool 自身 description；不额外提供 prompt snippet/guidelines。
- MCP `inputSchema` 原样作为 Pi tool parameters，由 Pi 的 raw JSON Schema 路径验证。

### 调用与结果

- 调用使用发现该 tool 的同一 server client，并把 Pi tool 参数作为 MCP `arguments`。
- 父调用的 `AbortSignal` 传给 SDK `callTool()`；SDK 负责对应 transport 的取消语义。
- MCP text/image 结果直接映射到 Pi text/image content。
- embedded text resource 加上 URI 后作为文本返回；resource link 返回名称、描述与 URI；audio 和二进制 resource 初版只返回类型/大小说明，不把不支持的 payload 注入模型。
- `structuredContent` 在没有原生 text/resource text 时序列化为文本；不把未受限的原始结构重复放入 details。MCP `isError` 转成 Pi tool error，错误文本同样经过输出保护。

### 输出保护与显示

- 所有 text blocks 合并后共享 50 KB / 2,000 行总额度，不能让每个 block 分别占满额度。
- 采用 head 截断；超长单行保留 UTF-8 安全前缀，不返回空预览。
- 超限时完整合并文本写入系统临时目录的 `pi-mcp-*/output.txt`，文件 mode 为 `0600`；模型结果明确给出原始字节/行数和路径。
- image blocks 不计入文本额度并原样保留。
- details 只保留 server、tool 和可选 truncation 统计/完整文本路径，不保留完整 structuredContent 副本。
- TUI collapsed 状态显示 `MCP server/tool`、最多 3 行且约 800 个源字符的结果以及 `Ctrl+O` 提示；expanded 状态显示经过上述硬上限保护后的全部结果。

### 动态目录

- session 启动后后台连接，不阻塞用户首条消息。
- server 初次 `tools/list` 完成后注册并激活工具；尚未完成的 server 从后续模型请求开始可用。
- `tools/list_changed` 重新同步该 server 的完整目录；新增项激活，删除项停用，相同目录不会改变工具命名。
- subagent 订阅同一 manager，因此继承当前及运行期间新发现的 MCP 工具，但不会创建或关闭额外连接。

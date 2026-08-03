# 验证状态

版本：`0.1.0`

最后更新：2026-08-03

## 已完成验收

- [x] 在已认证的多模态主模型上验收原图片读取路径（现已合并为增强 `read`）。
- [x] 在纯文本主模型与已配置 vision 模型上验收 fallback、usage 与取消。
- [x] 在 peer/advisor tier 上验收真实 subagent 的子工具集、transcript 与取消清理。
- [x] 在已认证的真实当前模型上验收首条消息异步命名、手工改名竞争与 fork 尾缀。
- [x] 单元测试覆盖 MCP 全局/项目配置覆盖、项目信任、直接工具注册、动态目录、调用参数、取消透传与连接清理。
- [x] 单元测试覆盖 MCP 多 block 总预算、超长单行 UTF-8 截断、完整文本落盘和 collapsed/expanded renderer。
- [x] 使用官方 SDK 实际连接 Exa Streamable HTTP（发现 2 个 tools）与 `@modelcontextprotocol/server-everything` stdio（发现 13 个 tools）。

## 延期验收

- [ ] 在非 Windows 平台实际执行原生 `bash` 路径。当前缺少相关设备，平台无关单元测试已覆盖；首次在其他平台使用时完成实机验收。
- [ ] 在 Pi 交互 session 中完成 MCP 工具调用、父子 session 共享和 `tools/list_changed` 人工验收。

延期项不阻塞 `0.1.0`。发布不创建 GitHub tag。

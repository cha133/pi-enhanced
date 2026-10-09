# pi-enhanced

`pi-enhanced` is a single-entry pi package that keeps pi's native tool surface small while improving batch editing and shell workflows.

Requires pi `1.1.0` or newer.

## Tools

| Tool | Behavior |
| --- | --- |
| `powershell` | On Windows, activates pi's native PowerShell tool instead of `bash`; prefers PowerShell 7 with Windows PowerShell 5.1 fallback, loads standard profiles, sets `TERM=dumb`, and adds version-specific syntax and shared ripgrep guidance. |
| `bash` | On macOS/Linux, activates native `bash` instead of PowerShell and adds ripgrep workflow guidance. |
| `read` | Uses pi's native reader unchanged, including text pagination, image attachments, and rendering. |
| `write` | Uses pi's native writer unchanged, including directory creation, cancellation, and rendering. |
| `edit` | Replaces pi's edit with partial-success batch replacement. Valid disjoint entries are applied atomically; invalid and overlapping entries are returned by index with bounded previews. |

`read` and `write` use pi's native definitions and keep their existing active states. There is no separate image-viewing tool.

The extension also records the first user message's timestamp and timezone as fixed session metadata. It injects them through pi 1.1.0's structured `session_info` prompt section and reuses them on later turns and when the session is resumed. Model metadata is not injected; legacy entries retain their original datetime while model text is omitted.

For a new empty session, the first text prompt immediately starts a non-blocking request to the current model for a concise session name. Manual names are never overwritten, failures and pure-image prompts keep pi's default name, and forks increment an inherited trailing ` (n)` suffix without another model request.

## Install

From GitHub:

```bash
pi install git:github.com/cha133/pi-enhanced
```

From a local checkout:

```bash
pi install /absolute/path/to/pi-enhanced
```

The package manifest exposes only `extensions/pi-enhanced.ts`; its internal modules are not separate extension entry points.

## Configuration

No package-specific configuration is required. On Windows, the selected PowerShell executable is queried once per extension instance for version-specific guidance: 7+ uses `&&` / `||`, while 5.1 uses explicit conditionals. Failed detection falls back to compatible guidance; `/reload` refreshes the cached version. At session start, the package selects only `powershell` on Windows or `bash` on other platforms, removing the legacy `pwsh` name from the active set while preserving unrelated tools. Pi's `!` / `!!` commands continue to use Bash. Image resizing follows pi's native settings. The former top-level `vision` setting is no longer read by this package and can be removed.

## Built-in MCP

MCP is managed by pi itself. This package no longer registers `mcp_search` / `mcp_call`, opens MCP connections, or renders historical MCP tools. It preserves active tools owned by pi and other extensions, including codemode and tool search.

Existing `~/.pi/agent/mcp.json` configurations with `mcpServers` work unchanged. Move legacy project `.mcp.json` entries to `.pi/mcp.json` (merge existing entries carefully). Project configuration still requires trust. Remove instructions that call the old tools and use pi's built-in MCP discovery/calls instead.

Pi defaults servers to `codemode` exposure and automatically activates codemode when they connect. Use `/mcp` to inspect servers and `pi mcp list` to verify connections; run `/reload` after configuration changes. See pi's bundled `docs/mcp.md` for exposure, OAuth, and resource support.

## Image behavior

Images are read by pi's native `read` tool and attached for the current model to inspect. Its parameters are `path`, `offset`, and `limit`; the former `image.query/detail` parameters have been removed. Image processing, automatic resizing, structured output, text pagination, errors, and rendering follow pi unchanged. Image reads do not make an additional model request.

## Edit behavior

Every `edits[]` entry is matched against one original file snapshot. Empty, missing, duplicate, no-op, and overlapping entries are rejected independently. Every member of an overlap group is rejected; all remaining entries are merged into one atomic write.

Rejected results include the original array index, an error code/message, and an explicitly incomplete bounded preview. They do not repeat full `oldText` or `newText`; retry only rejected indexes after reviewing the applied diff.

## Development

```bash
npm install
npm run typecheck
npm test
```

The current release is `0.1.0`.

# pi-enhanced

`pi-enhanced` is a single-entry pi package that keeps pi's native tool surface small while improving shell-based reading, batch editing, image inspection, and focused delegation.

Requires pi `0.83.0` or newer.

## Tools

| Tool | Behavior |
| --- | --- |
| `pwsh` | On Windows with PowerShell 7, replaces `bash`; loads the user profile, injects `TERM=dumb`, and includes PowerShell search/read/paging guidance. |
| `bash` | On other systems, keeps pi's native execution but adds ripgrep and bounded text-reading guidance. |
| `edit` | Replaces pi's edit with partial-success batch replacement. Valid disjoint entries are applied atomically; invalid and overlapping entries are returned by index with bounded previews. |
| `view_image` | Attaches pi-resized images directly to multimodal models or streams a compact status while a configured external vision model describes them for text-only models. |
| `subagent` | Runs isolated peer/advisor child sessions with the effective platform toolset, compact live status, cancellation, usage accounting, and transcript export. |

The built-in `read` tool is always disabled. Text is read through the effective shell; images are read through `view_image`. The built-in `write` tool remains active.

The extension also records the first user message's timestamp and first-turn model as fixed session metadata. It reuses that same information after later model switches and when the session is resumed.

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

No configuration is required for shell, edit, peer subagents, or multimodal image inspection. Optional model routes live at the top level of `~/.pi/agent/settings.json`:

```json
{
  "vision": {
    "provider": "openai",
    "model": "image-capable-model-id"
  },
  "advisor": {
    "provider": "anthropic",
    "model": "higher-capability-model-id"
  }
}
```

Trusted projects may override individual fields in `.pi/settings.json`.

- `vision` is required only when the current model cannot consume images. It must resolve to an image-capable model already registered in pi.
- `advisor` is optional. The advisor tier appears only when the configured model exists and differs from the current model.
- Peer subagents always inherit the current model and thinking level.

## Image behavior

`view_image` accepts:

```ts
{
  path: string;
  query?: string;
  detail?: "brief" | "standard" | "detailed";
}
```

`detail` controls analysis depth, not image resolution. Both direct and delegated paths use pi's automatic aspect-ratio-preserving image resize setting; the tool does not expose an original-resolution mode.

For a text-only current model, the result is explicitly described as delegated evidence from the configured vision model. The TUI shows a throttled single-line thinking/reply status while that nested request streams.

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

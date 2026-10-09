# AGENTS.md

## Project overview

`pi-enhanced` is a TypeScript pi package with one public extension entry point. It replaces or augments pi's shell, file, and image tools while preserving a minimal active tool surface. The supported pi baseline is `1.1.0`.

Read `docs/README.md` first, then open only the design document relevant to the task. Treat `docs/tool-specs.md` as the behavioral contract and `docs/configuration-and-decisions.md` as the record of accepted product decisions.

## Repository layout

- `extensions/pi-enhanced.ts`: the only public extension entry point.
- `extensions/lib/`: internal implementations. Do not expose these files as additional package entries.
- `tests/`: Bun tests, generally mirroring the modules in `extensions/lib/`.
- `docs/`: durable product, architecture, contract, decision, and verification documentation.

## Working rules

- Preserve the single-entry package surface declared in `package.json`.
- Use pi's native `read` without an override and preserve its existing active state. Do not add vision fallback, hashline behavior, or a separate `view_image` tool.
- Compute active tools from the existing active set and preserve tools registered by other extensions.
- At session start, activate only native `powershell` on Windows (PowerShell 7 preferred, Windows PowerShell 5.1 fallback) or native `bash` on other platforms. Preserve profile loading, `TERM=dumb`, version-specific syntax and shared search guidance, and unrelated active tools.
- Preserve `edit` partial-success semantics: classify replacements against one snapshot, reject every member of an overlap group, and commit accepted edits in one write.
- Preserve native read cancellation and rendering; image reads do not make nested model calls.
- Keep TypeScript strict and follow the existing tab-indented source style.
- Update the relevant durable documentation whenever behavior, configuration, architecture, or a recorded decision changes. Do not recreate `.agents/docs`; use temporary task notes outside the committed documentation when needed.

## Validation

Run the checks appropriate to the change, using the full set before release-oriented work:

```bash
npm run typecheck
npm test
npm pack --dry-run
```

Add or update focused Bun tests for behavior changes. Tests must not depend on user credentials or external model access unless the task explicitly concerns manual acceptance.

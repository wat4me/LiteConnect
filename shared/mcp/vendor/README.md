# Vendored bash grammar

`tree-sitter-bash.wasm` is the bash grammar used by the command classifier
(`shared/mcp/classify.ts`, via `electron/mcp/bashParser.ts`). It is checked in
because the packaged app must classify commands offline, and the build must not
depend on a network download.

## Provenance

| | |
|---|---|
| File | `tree-sitter-bash.wasm` |
| Size | 1 400 214 bytes |
| SHA-256 | `807dcdb1380a59befb112ed8fbd3d3872c7fadaf5903a769282b50973b30696d` |
| Taken from | npm package `tree-sitter-wasms@0.1.13`, `out/tree-sitter-bash.wasm` |
| Built from | `tree-sitter-bash@^0.20.5` (the version pinned by that packaging repo) |
| Language ABI | 14 (loadable by `web-tree-sitter@0.25.x`) |
| Licence | `tree-sitter-bash` is MIT (Copyright (c) 2017 Max Brunsfeld). The `tree-sitter-wasms` packaging repo is Unlicense. |

Upstream releases the same file at
`https://github.com/tree-sitter/tree-sitter-bash/releases/download/v0.25.1/tree-sitter-bash.wasm`
(newer grammar, same MIT terms). That host was unreachable from the machine that
vendored this copy, so the npm mirror was used instead — the parser output was
verified against the full case table in `electron/mcp/bashParser.test.ts`.

## Updating

1. Download the new `tree-sitter-bash.wasm` (prefer the upstream release above).
2. Confirm it still loads: `Language.load` reports the language ABI, and
   `window.__` — see `bashAstStatus().grammar`, which prints `bash@abi<14>`.
3. Replace the file, update the table above, then run
   `vitest run electron/mcp/bashParser.test.ts` and update
   `scripts/copy-bash-wasm.mjs` only if the file name changed.

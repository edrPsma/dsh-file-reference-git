# dsh-file-reference-git

Scalable `@file` completion for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): index the **whole workspace** via `git ls-files` so large repos stay searchable, like Codex / Claude's `@`.

## Why

DSH's built-in `@file` provider (`dsh-file-reference-local`) builds its index with a directory traversal capped at `maxEntries: 50000`. Once a repo exceeds ~50k files, **everything after the cap is never indexed** and `@` cannot find it. Large Unity / game / enterprise repos (100k+ files) hit this immediately.

This plugin swaps the index source for `git ls-files`, which returns **all** tracked files in one shot:

- any number of files stays searchable (verified on a 122k-file repo → 130k index entries, ~50ms fuzzy queries)
- generated dirs such as `Library/`, `Temp/`, `obj/`, `node_modules/` are excluded via `.gitignore`
- non-git repos fall back to a bounded directory traversal (cap 500k)

## Features

- **git-first**: git repos are indexed with `git ls-files --cached --others --exclude-standard`, covering committed, staged, and untracked-but-not-ignored files
- **new files included**: a freshly created file (whether `git add`ed or not) is within index scope
- **respects .gitignore**: git-ignored files never enter the index
- **fuzzy ranking**: exact > prefix > substring > subsequence (directories get a bonus)
- **directory drill-down**: typing `@dir/` lists that directory's contents live, unaffected by index caching

## Install

### Option 1: Web UI

**Plugins → Add plugin → choose a local directory or tarball**.

### Option 2: CLI

```sh
dsh plugin add ./dsh-file-reference-git            # local directory
dsh plugin add ./dsh-file-reference-git-1.0.0.tgz  # tarball
```

Restart DSH afterwards. The plugin disables the built-in `file-reference-local` and mounts itself through its own `cordis.patch.yml` — no manual config needed.

## Usage

- type `@` alone to list root-level candidates
- type `@name` to fuzzy-match files across the whole repo (e.g. `@BuildAndroid`)
- type `@dir/` to drill into a directory and list its contents live
- paths with spaces are quoted automatically (`@"path with spaces"`)

## Config (optional)

Override by row id in the profile's `cordis.patch.yml`:

```yaml
- id: file-reference-git
  config:
    maxResults: 50          # candidates per query (default 50)
    maxEntries: 500000      # traversal cap, non-git fallback only (default 500000)
    excludedDirectories:    # dirs skipped in the fallback traversal; [] disables exclusion
      - .git
      - node_modules
      - dist
      - build
```

> `maxEntries` only constrains the non-git traversal fallback; the git path always returns the full tracked set.
> Passing `excludedDirectories: []` disables exclusion in the fallback traversal.

## Troubleshooting

When `@` finds nothing, check in order:

1. **Right workspace** — is the sidebar's workspace your project directory? `@` only searches the current session's workspace.
2. **Git repo?** — the git path uses `git ls-files`; non-git paths fall back to traversal (affected by `maxEntries` and `excludedDirectories`).
3. **Ignored file?** — on the git path, files ignored by `.gitignore` do not appear.
4. **Restarted?** — installing/updating the plugin requires a DSH restart to take effect.

## Limitations

- The git path needs `git` on the DSH host's PATH; it falls back to directory traversal otherwise.
- The first fuzzy query spawns one git process (~0.5s on very large repos), then the index is cached.
- The index is marked stale after each tool result and rebuilt in the background on the next query — a new file becomes visible on the next query.

## License

MIT

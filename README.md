# dsh-file-reference-git

Scalable `@file` completion for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): index the **whole workspace** via `git ls-files` so large repos stay searchable, like Codex / Claude's `@`.

## Why

DSH's built-in `@file` provider (`dsh-file-reference-local`) builds its index with a directory traversal capped at `maxEntries: 50000`. Once a repo exceeds ~50k files, **everything after the cap is never indexed** and `@` cannot find it. Large Unity / game / enterprise repos (100k+ files) hit this immediately.

This plugin swaps the index source for `git ls-files`, which returns **all** tracked files in one shot (git applies `.gitignore` itself). So:

- any number of files stays searchable (verified on a 122k-file repo → 130k index entries, ~50ms fuzzy queries)
- generated dirs such as `Library/`, `Temp/`, `obj/`, `node_modules/` are excluded via `.gitignore`, no longer polluting the index
- non-git repos fall back to a bounded directory traversal (cap 500k)

## Install

```sh
# from a tarball
dsh plugin add ./dsh-file-reference-git-1.0.0.tgz

# from a directory
dsh plugin add ./dsh-file-reference-git

# after publishing to npm
dsh plugin add dsh-file-reference-git
```

Restart DSH afterwards. The plugin disables the built-in `file-reference-local` and mounts itself through its own `cordis.patch.yml` — no manual config needed.

## Config (optional)

```yaml
- id: file-reference-git
  config:
    maxResults: 50        # candidates per query (default 50)
    maxEntries: 500000    # traversal cap, non-git fallback only (default 500000)
    excludedDirectories: [] # extra dirs to skip in the fallback traversal
```

`maxEntries` only applies to the non-git traversal fallback; the git path always returns the full tracked set.

## Limitations

- The git path needs `git` on the DSH host's PATH; it falls back to directory traversal otherwise.
- The first fuzzy query spawns one git process (~0.5s on very large repos), then the index is cached.

## License

MIT

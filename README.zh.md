# dsh-file-reference-git

让 DeepSeek Harness 的 `@` 文件补全在**超大仓库**里也能秒搜到文件，像 Codex / Claude 的 `@` 一样好用。

## 它解决什么问题

DSH 内置的 `@file` 补全（`dsh-file-reference-local`）用目录遍历建立索引，且有个 `maxEntries: 50000` 的硬上限。仓库一旦超过约 5 万个文件，**后面的文件根本进不了索引**，`@` 怎么搜都搜不到。大型 Unity / 游戏 / 企业仓库动辄 10 万+ 文件，几乎必中招。

这个插件把索引来源换成 `git ls-files`，一次拿到仓库里**全部**受跟踪文件（git 自己负责 `.gitignore` 语义），因此：

- 文件再多也能搜（实测 12 万文件仓库，索引 13 万条目，模糊查询 ~50ms）
- `.gitignore` 里的 `Library/`、`Temp/`、`obj/`、`node_modules/` 等生成目录天然被排除，不再污染索引
- 非 git 仓库自动回退到目录遍历（上限 50 万）

## 原理

```
@foo 输入
  └─ 是 git 仓库？
       ├─ 是 → git ls-files --cached --others --exclude-standard   （全部源码文件）
       └─ 否 → 有界目录遍历（排除 node_modules/dist/build/... 等）
  └─ 对路径列表做模糊排序：精确 > 前缀 > 子串 > 子序列（目录有加成）
  └─ 返回前 maxResults 条
```

目录下钻（`@dir/`）仍然实时读取目录内容，不受索引影响。

## 安装

### 方式一：本地 tar 包

```sh
dsh plugin add ./dsh-file-reference-git-1.0.0.tgz
```

### 方式二：本地目录

```sh
dsh plugin add ./dsh-file-reference-git
```

### 方式三：发布到 npm 后

```sh
npm publish
dsh plugin add dsh-file-reference-git
```

安装后**重启 DSH** 生效。插件会通过自己的 `cordis.patch.yml` 禁用内置的 `file-reference-local` 并挂载自身，无需手动改配置。

## 配置（可选）

在所选 profile 的 `cordis.patch.yml` 里覆盖：

```yaml
- id: file-reference-git
  config:
    maxResults: 50        # 单次返回的候选上限（默认 50）
    maxEntries: 500000    # 非 git 仓库回退遍历时的索引上限（默认 500000）
    excludedDirectories:  # 回退遍历时排除的目录名（默认见下）
      - .git
      - node_modules
      - dist
      - build
      # ...
```

> 说明：git 仓库路径下 `maxEntries` 不生效（`git ls-files` 直接给全量文件）；它只约束非 git 仓库的目录遍历回退。

## 已知限制

- git 仓库路径依赖 `git` 在 DSH 宿主进程的 PATH 上；找不到 git 时自动回退到目录遍历。
- 首次模糊查询会起一次 git 子进程（大仓库约 0.5 秒），之后缓存、无感。
- 索引在每次工具结果后标记陈旧、下次查询后台重建，和内置行为一致。

## License

MIT

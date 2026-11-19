# dsh-file-reference-git

让 DeepSeek Harness 的 `@` 文件补全在**超大仓库**里也能秒搜到文件，像 Codex / Claude 的 `@` 一样好用。

## 为什么需要

DSH 内置的 `@file` 补全（`dsh-file-reference-local`）用目录遍历建立索引，并且有 `maxEntries: 50000` 的硬上限。仓库一旦超过约 5 万个文件，上限之后的文件就**永远不会进索引**，`@` 怎么搜都搜不到。大型 Unity / 游戏 / 企业仓库动辄 10 万+ 文件，几乎必中招。

本插件把索引来源换成 `git ls-files`，一次拿到仓库里**全部**受跟踪文件：

- 文件再多也能搜（实测 12 万文件仓库 → 13 万索引条目，模糊查询 ~50ms）
- `.gitignore` 里的 `Library/`、`Temp/`、`obj/`、`node_modules/` 等生成目录天然被排除
- 非 git 仓库自动回退到目录遍历（上限 50 万）

## 特性

- **git 优先**：git 仓库用 `git ls-files --cached --others --exclude-standard` 索引，覆盖已提交、已暂存、未跟踪（且未被忽略）的所有文件
- **新增文件也能搜到**：刚创建的文件（无论是否 `git add`）都在索引范围内
- **尊重 .gitignore**：被 git 忽略的文件不进入索引
- **模糊排序**：精确 > 前缀 > 子串 > 子序列（目录有加成）
- **目录下钻**：输入 `@目录/` 实时读取目录内容，不受索引缓存影响

## 安装

### 方式一：Web 界面

**插件 → 添加插件 → 选择本地目录或 tar 包**。

### 方式二：命令行

```sh
dsh plugin add ./dsh-file-reference-git            # 本地目录
dsh plugin add ./dsh-file-reference-git-1.0.0.tgz  # tar 包
```

安装后**重启 DSH** 生效。插件通过自己的 `cordis.patch.yml` 禁用内置的 `file-reference-local` 并挂载自身，无需手动改配置。

## 使用

- 输入 `@` 单独触发，列出根目录候选
- 输入 `@文件名` 模糊匹配整个仓库的文件（例如 `@BuildAndroid`）
- 输入 `@目录/` 下钻到该目录，实时列出内容
- 路径含空格时自动加引号（`@"path with spaces"`）

## 配置（可选）

在所选 profile 的 `cordis.patch.yml` 里按 id 覆盖：

```yaml
- id: file-reference-git
  config:
    maxResults: 50          # 单次返回候选数（默认 50）
    maxEntries: 500000      # 非 git 回退遍历的索引上限（默认 500000）
    excludedDirectories:    # 非 git 回退时排除的目录名；传 [] 表示不排除
      - .git
      - node_modules
      - dist
      - build
```

> `maxEntries` 只约束非 git 仓库的目录遍历回退；git 路径始终返回全量跟踪文件，不受此限制。
> `excludedDirectories` 传空数组 `[]` 会关闭回退遍历的排除。

## 故障排查

`@` 搜不到文件时，按顺序检查：

1. **工作区对吗**——侧边栏「工作区」是否是你的项目目录？`@` 只搜当前会话的工作区。
2. **是 git 仓库吗**——git 路径用 `git ls-files`；非 git 路径回退到目录遍历（受 `maxEntries` 和 `excludedDirectories` 影响）。
3. **文件被忽略了吗**——git 路径下，`.gitignore` 忽略的文件不出现。
4. **重启了吗**——安装 / 更新插件后需重启 DSH 才生效。

## 已知限制

- git 路径依赖 `git` 在 DSH 宿主进程的 PATH 上；找不到时自动回退到目录遍历。
- 首次模糊查询会起一次 git 子进程（大仓库约 0.5 秒），之后索引缓存、无感。
- 索引在每次工具结果后标记陈旧、下一次查询后台重建——新文件在下一次查询即可见。

## License

MIT

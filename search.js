import { lstat, readdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const execFileAsync = promisify(execFile)

export const DEFAULT_EXCLUDED = [
  '.git', 'node_modules', 'dist', 'build', 'out', 'coverage', 'target',
  '.next', '.nuxt', '.turbo', '.venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.gradle',
  'Library', 'Temp', 'obj', 'Logs', 'ServerData', 'builds',
]

// ---------------------------------------------------------------------------
// Ranking (exact > prefix > substring > subsequence, directory bonus).
// `lower` is precomputed once at index time so keystrokes avoid re-lowercasing.
// ---------------------------------------------------------------------------

function scoreCandidate(candidate, query) {
  if (query === '') return 0
  const path = candidate.lower
  const name = path.slice(path.lastIndexOf('/') + 1)
  const needle = query.toLowerCase()
  const directoryBonus = candidate.kind === 'directory' ? 25 : 0
  if (name === needle) return 1000 + directoryBonus
  if (name.startsWith(needle)) return 900 + directoryBonus
  if (name.includes(needle)) return 700 + directoryBonus
  if (path.includes(needle)) return 500 + directoryBonus
  let targetIndex = 0, gap = 0
  for (const ch of needle) {
    const found = path.indexOf(ch, targetIndex)
    if (found < 0) return undefined
    gap += found - targetIndex
    targetIndex = found + 1
  }
  return 300 + Math.max(0, 100 - gap) + directoryBonus
}

function rank(candidates, query, limit) {
  const ranked = []
  for (const c of candidates) {
    const s = scoreCandidate(c, query)
    if (s !== undefined) ranked.push({ c, s })
  }
  ranked.sort((a, b) =>
    b.s - a.s
    || (a.c.kind === 'directory' ? 0 : 1) - (b.c.kind === 'directory' ? 0 : 1)
    || (query === '' ? 0 : a.c.path.length - b.c.path.length)
    || (a.c.path < b.c.path ? -1 : a.c.path > b.c.path ? 1 : 0))
  return ranked.slice(0, limit).map(e => e.c)
}

function visibleForGlobalQuery(path, query) {
  if (query.startsWith('.') || query.includes('/.')) return true
  return !path.split('/').some(seg => seg.startsWith('.'))
}

/**
 * Workspace file index. In a git repo the entry list comes from
 * `git ls-files` (tracked + untracked-but-not-ignored), so it respects
 * .gitignore via git itself and scales to very large repositories; otherwise
 * it falls back to a bounded directory traversal.
 */
export class WorkspaceIndex {
  constructor(root, config) {
    this.root = root
    this.maxResults = config.maxResults
    this.maxEntries = config.maxEntries
    this.excluded = new Set(config.excludedDirectories)
    this.settled = undefined
    this.generation = undefined
    this.invalidations = 0
    this.disposed = false
  }

  async list(rawQuery, signal) {
    signal.throwIfAborted()
    if (this.disposed) return []
    const query = rawQuery.replaceAll('\\', '/')
    const slash = query.lastIndexOf('/')
    if (query === '' || slash >= 0) {
      const directory = slash < 0 ? '' : query.slice(0, slash + 1)
      const fragment = slash < 0 ? '' : query.slice(slash + 1)
      return this.listDirectory(directory, fragment, signal)
    }
    const indexed = await this.indexFor(signal)
    return rank(indexed.filter(c => visibleForGlobalQuery(c.path, query)), query, this.maxResults)
  }

  invalidate() { this.invalidations += 1 }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.generation?.controller.abort()
    this.generation = undefined
    this.settled = undefined
  }

  async indexFor(signal) {
    const settled = this.settled
    if (settled === undefined) return this.wait(this.ensureIndex(), signal)
    if (settled.startedAt < this.invalidations) void this.ensureIndex().catch(() => {})
    return settled.entries
  }

  wait(promise, signal) {
    if (signal.aborted) return Promise.reject(new Error('aborted'))
    return new Promise((res, rej) => {
      const onAbort = () => rej(new Error('aborted'))
      signal.addEventListener('abort', onAbort, { once: true })
      promise.then(
        v => { signal.removeEventListener('abort', onAbort); res(v) },
        e => { signal.removeEventListener('abort', onAbort); rej(e) },
      )
    })
  }

  ensureIndex() {
    if (this.generation !== undefined) return this.generation.promise
    const controller = new AbortController()
    const startedAt = this.invalidations
    const generation = { controller, promise: Promise.resolve([]) }
    generation.promise = this.buildIndex(controller.signal).then(entries => {
      if (!this.disposed) {
        this.generation = undefined
        this.settled = { entries, startedAt }
      }
      return entries
    }, err => {
      if (this.generation === generation) this.generation = undefined
      throw err
    })
    this.generation = generation
    return generation.promise
  }

  async buildIndex(signal) {
    const git = await this.gitIndex(signal)
    if (git !== undefined) return git
    return this.traverseIndex(signal)
  }

  async gitIndex(signal) {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        { cwd: this.root, maxBuffer: 512 * 1024 * 1024, signal, windowsHide: true },
      )
      const files = []
      for (const raw of stdout.split('\0')) {
        if (raw === '') continue
        const path = raw.replaceAll('\\', '/')
        files.push({ path, kind: 'file', lower: path.toLowerCase() })
      }
      if (files.length === 0) return files
      const dirSet = new Map()
      for (const f of files) {
        const parts = f.path.split('/')
        for (let i = 1; i < parts.length; i++) {
          const d = parts.slice(0, i).join('/')
          if (!dirSet.has(d)) dirSet.set(d, { path: d, kind: 'directory', lower: d.toLowerCase() })
        }
      }
      return [...dirSet.values(), ...files]
    } catch (error) {
      if (signal.aborted) throw error
      return undefined // not a git repo / git unavailable → fall back to traversal
    }
  }

  async traverseIndex(signal) {
    const indexed = []
    const dirs = [{ absolute: this.root, relative: '' }]
    for (let cursor = 0; cursor < dirs.length && indexed.length < this.maxEntries; cursor++) {
      signal.throwIfAborted()
      const dir = dirs[cursor]
      let entries
      try { entries = await readdir(dir.absolute, { withFileTypes: true }) } catch { continue }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      for (const entry of entries) {
        signal.throwIfAborted()
        const path = dir.relative === '' ? entry.name : `${dir.relative}/${entry.name}`
        if (entry.isDirectory()) {
          if (this.excluded.has(entry.name)) continue
          indexed.push({ path, kind: 'directory', lower: path.toLowerCase() })
          dirs.push({ absolute: join(dir.absolute, entry.name), relative: path })
        } else if (entry.isFile()) {
          indexed.push({ path, kind: 'file', lower: path.toLowerCase() })
        }
        if (indexed.length >= this.maxEntries) break
      }
    }
    return indexed
  }

  async listDirectory(displayDirectory, fragment, signal) {
    if (displayDirectory.split('/').some(seg => this.excluded.has(seg))) return []
    const resolvedRoot = resolve(this.root)
    const absolute = resolve(resolvedRoot, displayDirectory === '' ? '.' : displayDirectory)
    const fromRoot = relative(resolvedRoot, absolute)
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) return []
    if (isAbsolute(fromRoot)) return []
    let current = resolvedRoot
    for (const segment of fromRoot.split(sep).filter(Boolean)) {
      signal.throwIfAborted()
      current = join(current, segment)
      try {
        const st = await lstat(current)
        if (st.isSymbolicLink() || !st.isDirectory()) return []
      } catch { return [] }
    }
    let entries
    try { entries = await readdir(absolute, { withFileTypes: true }) } catch { return [] }
    const candidates = []
    for (const entry of entries) {
      if (entry.name.startsWith('.') && !fragment.startsWith('.')) continue
      const path = `${displayDirectory}${entry.name}`
      if (entry.isDirectory()) {
        if (this.excluded.has(entry.name)) continue
        candidates.push({ path, kind: 'directory', lower: path.toLowerCase() })
      } else if (entry.isFile()) {
        candidates.push({ path, kind: 'file', lower: path.toLowerCase() })
      }
    }
    return rank(candidates, fragment, this.maxResults)
  }
}

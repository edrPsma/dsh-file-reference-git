import { WorkspaceIndex, DEFAULT_EXCLUDED } from './search.js'

const FILE_REFERENCE_PROMPT = 'Tokens prefixed with @ are paths the user explicitly referenced. Relative paths resolve from the workspace root; absolute paths identify files or directories on the host. A trailing slash marks a directory: list it when its contents matter. Anything else is a file: use the read tool when its contents are needed, and do not claim to have inspected it before reading. @"..." quotes a path containing spaces.'

export const name = 'dsh-file-reference-git'
export const inject = ['workingDirectory', 'agents']

/**
 * Local `ctx.fileReferences` provider. In a git repo the index comes from
 * `git ls-files` (fast, .gitignore-aware, scales to very large repos);
 * otherwise it falls back to a bounded directory traversal. Written against
 * the Cordis `ctx` surface only (provide/get/on/effect/inject) so it needs no
 * host-only `@deepseek-ai/*` import, which a profile bundle cannot resolve.
 */
export function apply(ctx) {
  const config = { maxResults: 50, maxEntries: 500000, excludedDirectories: DEFAULT_EXCLUDED }
  const searches = new Map() // agent -> { cwd, index }
  const promptFibers = new Map() // agent -> fiber

  const searchFor = async (agent, signal) => {
    const cwd = await ctx.workingDirectory.ensure(agent, signal)
    let cached = searches.get(agent)
    if (cached?.cwd !== cwd) {
      cached?.index.dispose()
      cached = { cwd, index: new WorkspaceIndex(cwd, config) }
      searches.set(agent, cached)
    }
    return cached.index
  }

  ctx.provide('fileReferences', {
    list: async (agent, query, signal) => {
      const index = await searchFor(agent, signal)
      return index.list(query, signal)
    },
  })

  const installPrompt = (agent) => {
    if (promptFibers.has(agent)) return
    const fiber = agent.ctx.inject(['systemPrompt', 'tools'], (scope) => {
      scope.systemPrompt.section({
        name: 'context:file-reference',
        order: scope.systemPrompt.getSectionOrder('FILE_REFERENCE'),
        text: () => (agent.ctx.tools.get('read', agent) === undefined ? '' : FILE_REFERENCE_PROMPT),
      })
    })
    promptFibers.set(agent, fiber)
  }
  const disposePrompt = (agent) => {
    const fiber = promptFibers.get(agent)
    if (fiber === undefined) return
    promptFibers.delete(agent)
    fiber.dispose().catch((error) => {
      ctx.logger.warn(`file-reference-git: prompt cleanup failed: ${error?.message ?? error}`)
    })
  }

  for (const agent of ctx.agents.list()) installPrompt(agent)
  ctx.on('agent/created', async ({ agent }) => { await installPrompt(agent) })
  ctx.on('agent/disposed', ({ agent }) => {
    searches.get(agent)?.dispose()
    searches.delete(agent)
    disposePrompt(agent)
  })
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'tool/result') return
    const agent = ctx.agents.get(session.id)
    if (agent !== undefined) searches.get(agent)?.invalidate()
  })

  ctx.effect(() => async () => {
    for (const { index } of searches.values()) index.dispose()
    searches.clear()
    const fibers = [...promptFibers.values()]
    promptFibers.clear()
    await Promise.all(fibers.map((fiber) => fiber.dispose()))
  }, 'file-reference-git: cache')
}

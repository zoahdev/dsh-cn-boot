/**
 * China-network bootstrap core for dsh-cn-boot.
 *
 * Probes the registries and hosts that matter to a DeepSeek Harness user in
 * mainland China, reads current npm/pnpm registry config, detects a local
 * proxy, produces mirror recommendations and a copy-paste bootstrap script.
 * Everything is read-only unless `apply` is explicitly requested.
 * @module dsh-cn-boot/boot
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export interface ProbeTarget {
  id: string
  name: string
  url: string
  method?: 'GET' | 'HEAD'
}

export type ProbeResult = {
  id: string
  name: string
  url: string
  ok: boolean
  status: number | null
  latencyMs: number
  detail: string
}

export type RegistryConfig = {
  npmRegistry: string
  pnpmRegistry: string
  proxyEnv: string | null
}

export type Recommendation = {
  action: string
  command: string | null
  reason: string
}

export type AppliedResult = {
  action: string
  ok: boolean
  detail: string
}

export type BootResult = {
  schema: 'dsh-cn-boot/v1'
  ok: boolean
  probes: ProbeResult[]
  config: RegistryConfig
  recommendations: Recommendation[]
  script: string
  applied: AppliedResult[]
  warnings: string[]
}

export interface BootDeps {
  fetchImpl?: typeof fetch
  /** Inject config reads/apply for tests; defaults to real pnpm/npm commands. */
  execImpl?: (cmd: string, args: string[]) => { status: number; stdout: string; stderr?: string }
  env?: Record<string, string | undefined>
  home?: string
  now?: () => number
}

export const PROBE_TARGETS: ProbeTarget[] = [
  { id: 'npmjs', name: 'npm registry (registry.npmjs.org)', url: 'https://registry.npmjs.org/-/ping' },
  { id: 'npmmirror', name: 'npmmirror (registry.npmmirror.com)', url: 'https://registry.npmmirror.com/-/ping' },
  { id: 'github', name: 'GitHub (github.com)', url: 'https://github.com', method: 'HEAD' },
  { id: 'raw-github', name: 'GitHub raw (raw.githubusercontent.com)', url: 'https://raw.githubusercontent.com', method: 'HEAD' },
  { id: 'huggingface', name: 'Hugging Face (huggingface.co)', url: 'https://huggingface.co', method: 'HEAD' },
  { id: 'gitee', name: 'Gitee (gitee.com)', url: 'https://gitee.com', method: 'HEAD' },
  { id: 'proxy-7897', name: 'Local proxy (127.0.0.1:7897)', url: 'http://127.0.0.1:7897', method: 'HEAD' },
  { id: 'proxy-10809', name: 'Local proxy (127.0.0.1:10809)', url: 'http://127.0.0.1:10809', method: 'HEAD' },
]

export const NPM_MIRROR = 'https://registry.npmmirror.com'

function defaultExec(cmd: string, args: string[]) {
  return spawnSync(cmd, args, { encoding: 'utf8', timeout: 10_000 })
}

async function readNpmrcRegistry(file: string): Promise<string | null> {
  try {
    const raw = await readFile(file, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const match = /^\s*registry\s*=\s*(\S+)/.exec(line)
      if (match !== null) return match[1]
    }
    return null
  } catch {
    return null
  }
}

/** Read the current registry configuration without changing anything. */
export async function readRegistryConfig(deps: BootDeps = {}): Promise<RegistryConfig> {
  const env = deps.env ?? process.env
  const home = deps.home ?? env.HOME ?? env.USERPROFILE ?? ''
  const execImpl = deps.execImpl ?? defaultExec

  let npmRegistry = env.NPM_CONFIG_REGISTRY?.trim() ?? ''
  if (npmRegistry === '') {
    const userNpmrc = await readNpmrcRegistry(path.join(home, '.npmrc'))
    npmRegistry = userNpmrc ?? ''
  }
  if (npmRegistry === '') {
    const result = execImpl('npm', ['config', 'get', 'registry'])
    if (result.status === 0) npmRegistry = result.stdout.trim()
  }

  let pnpmRegistry = env.NPM_CONFIG_REGISTRY?.trim() ?? ''
  if (pnpmRegistry === '') {
    const result = execImpl('pnpm', ['config', 'get', 'registry'])
    if (result.status === 0) pnpmRegistry = result.stdout.trim()
  }

  const proxyEnv = env.HTTPS_PROXY?.trim() || env.https_proxy?.trim() || env.HTTP_PROXY?.trim() || env.http_proxy?.trim() || null

  return { npmRegistry, pnpmRegistry, proxyEnv }
}

/** Probe one target; any received response counts as reachable. */
async function probeOne(
  target: ProbeTarget,
  timeoutMs: number,
  fetchImpl: typeof fetch,
  now: () => number,
): Promise<ProbeResult> {
  const start = now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(target.url, { method: target.method ?? 'GET', signal: controller.signal, redirect: 'follow' })
    const latencyMs = Math.round(now() - start)
    const status = response.status
    const ok = status < 500
    return {
      id: target.id,
      name: target.name,
      url: target.url,
      ok,
      status,
      latencyMs,
      detail: ok ? `HTTP ${status} in ${latencyMs}ms` : `HTTP ${status}`,
    }
  } catch (error) {
    const latencyMs = Math.round(now() - start)
    const detail = String(error instanceof Error ? error.message : error)
    return {
      id: target.id,
      name: target.name,
      url: target.url,
      ok: false,
      status: null,
      latencyMs,
      detail,
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Build a copy-paste bootstrap script (PowerShell + bash). */
export function buildScript(recommendations: Recommendation[], registryConfig: RegistryConfig): string {
  const ps: string[] = ['# PowerShell — run in a terminal']
  const bash: string[] = ['# bash/zsh — run in a terminal']
  let added = false

  const registryRec = recommendations.find((r) => r.action === 'set-registry')
  if (registryRec !== null && registryRec !== undefined) {
    const mirror = registryRec.command?.includes(NPM_MIRROR) ? NPM_MIRROR : 'https://registry.npmmirror.com'
    ps.push(`pnpm config set registry ${mirror}`)
    ps.push(`npm config set registry ${mirror}`)
    bash.push(`pnpm config set registry ${mirror}`)
    bash.push(`npm config set registry ${mirror}`)
    added = true
  }

  const proxyRec = recommendations.find((r) => r.action === 'use-proxy')
  if (proxyRec !== null && proxyRec !== undefined) {
    ps.push('$env:HTTP_PROXY = "http://127.0.0.1:7897"')
    ps.push('$env:HTTPS_PROXY = "http://127.0.0.1:7897"')
    bash.push('export HTTP_PROXY=http://127.0.0.1:7897')
    bash.push('export HTTPS_PROXY=http://127.0.0.1:7897')
    added = true
  }

  if (registryConfig.proxyEnv !== null) {
    ps.push(`$env:HTTPS_PROXY = "${registryConfig.proxyEnv}"`)
    bash.push(`export HTTPS_PROXY=${registryConfig.proxyEnv}`)
    added = true
  }

  if (!added) {
    ps.push('# No bootstrap actions needed — connectivity looks fine.')
    bash.push('# No bootstrap actions needed — connectivity looks fine.')
  }

  return ps.join('\n') + '\n\n' + bash.join('\n') + '\n'
}

/** Derive recommendations from probe results and current config. */
export function recommend(probes: ProbeResult[], config: RegistryConfig): Recommendation[] {
  const recommendations: Recommendation[] = []
  const byId = new Map(probes.map((probe) => [probe.id, probe]))

  const npmjs = byId.get('npmjs')
  const mirror = byId.get('npmmirror')
  if (npmjs !== undefined && !npmjs.ok && mirror !== undefined && mirror.ok) {
    recommendations.push({
      action: 'set-registry',
      command: `pnpm config set registry ${NPM_MIRROR}`,
      reason: `registry.npmjs.org unreachable (${npmjs.detail}); npmmirror responds HTTP ${mirror.status} in ${mirror.latencyMs}ms`,
    })
  }

  const github = byId.get('github')
  const proxy = byId.get('proxy-7897') ?? byId.get('proxy-10809')
  if (github !== undefined && !github.ok && proxy !== undefined && proxy.ok) {
    recommendations.push({
      action: 'use-proxy',
      command: 'export HTTPS_PROXY=http://127.0.0.1:7897',
      reason: `github.com unreachable (${github.detail}) but a local proxy responds (${proxy.id} HTTP ${proxy.status})`,
    })
  }

  if (config.proxyEnv !== null && github !== undefined && !github.ok) {
    recommendations.push({
      action: 'reuse-proxy-env',
      command: null,
      reason: `A proxy is already configured in the environment (${config.proxyEnv}) but github.com is still unreachable; verify the proxy is running and that git/npm honor it.`,
    })
  }

  return recommendations
}

/** Apply recommendations (registry only; explicit opt-in). */
export async function applyRecommendations(
  recommendations: Recommendation[],
  deps: BootDeps = {},
): Promise<AppliedResult[]> {
  const applied: AppliedResult[] = []
  const execImpl = deps.execImpl ?? defaultExec
  for (const rec of recommendations) {
    if (rec.action !== 'set-registry') continue
    const steps = [
      { cmd: 'pnpm', args: ['config', 'set', 'registry', NPM_MIRROR] },
      { cmd: 'npm', args: ['config', 'set', 'registry', NPM_MIRROR] },
    ]
    for (const step of steps) {
      try {
        const result = execImpl(step.cmd, step.args)
        applied.push({
          action: `${step.cmd} config set registry`,
          ok: result.status === 0,
          detail: result.status === 0 ? NPM_MIRROR : `exit ${result.status}: ${(result.stderr ?? result.stdout).slice(0, 120)}`,
        })
      } catch (error) {
        applied.push({
          action: `${step.cmd} config set registry`,
          ok: false,
          detail: String(error instanceof Error ? error.message : error),
        })
      }
    }
  }
  return applied
}

/** Run the full China-network bootstrap diagnosis. */
export async function cnBoot(options: { apply?: boolean; timeoutMs?: number } = {}, deps: BootDeps = {}): Promise<BootResult> {
  const timeoutMs = options.timeoutMs ?? 5000
  const fetchImpl = deps.fetchImpl ?? fetch
  const now = deps.now ?? Date.now

  const probes: ProbeResult[] = []
  for (const target of PROBE_TARGETS) {
    probes.push(await probeOne(target, timeoutMs, fetchImpl, now))
  }

  const config = await readRegistryConfig(deps)
  const recommendations = recommend(probes, config)
  const script = buildScript(recommendations, config)
  const applied = options.apply === true ? await applyRecommendations(recommendations, deps) : []

  const warnings: string[] = []
  const failed = probes.filter((probe) => !probe.ok)
  if (failed.length > 0) {
    warnings.push(`${failed.length} of ${probes.length} targets unreachable: ${failed.map((p) => p.id).join(', ')}`)
  }

  return {
    schema: 'dsh-cn-boot/v1',
    ok: recommendations.length === 0,
    probes,
    config,
    recommendations,
    script,
    applied,
    warnings,
  }
}
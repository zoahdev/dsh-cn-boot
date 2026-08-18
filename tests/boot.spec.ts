import { describe, expect, it } from 'vitest'
import {
  cnBoot,
  recommend,
  buildScript,
  readRegistryConfig,
  PROBE_TARGETS,
  NPM_MIRROR,
  type ProbeResult,
  type RegistryConfig,
  type BootDeps,
} from '../src/boot.js'

function okProbe(id: string, url = 'https://x', latencyMs = 12): ProbeResult {
  return { id, name: id, url, ok: true, status: 200, latencyMs, detail: `HTTP 200 in ${latencyMs}ms` }
}

function failProbe(id: string, detail = 'ECONNREFUSED'): ProbeResult {
  return { id, name: id, url: 'https://x', ok: false, status: null, latencyMs: 5000, detail }
}

function fetchMock(map: Record<string, boolean>): typeof fetch {
  return (async (input, _init) => {
    const url = String(input)
    const ok = map[url] ?? true
    if (!ok) throw new Error('network unreachable')
    return { status: 200 } as Response
  }) as unknown as typeof fetch
}

const execNoop: BootDeps['execImpl'] = () => ({ status: 0, stdout: '' })

describe('readRegistryConfig', () => {
  it('reads env, .npmrc, then commands', async () => {
    const calls: string[][] = []
    const config = await readRegistryConfig({
      env: { HOME: '/home/u', USERPROFILE: '/home/u' },
      home: '/home/u',
      execImpl: (cmd, args) => {
        calls.push([cmd, ...args])
        return { status: 0, stdout: 'https://registry.example.com\n' }
      },
    })
    expect(config.npmRegistry).toBe('https://registry.example.com')
    expect(calls.length).toBeGreaterThan(0)
  })

  it('reads proxy from env', async () => {
    const config = await readRegistryConfig({ env: { HTTPS_PROXY: 'http://127.0.0.1:7897' }, home: '/tmp', execImpl: execNoop })
    expect(config.proxyEnv).toBe('http://127.0.0.1:7897')
  })
})

describe('recommend', () => {
  it('recommends npmmirror when npmjs fails and the mirror works', () => {
    const probes = [
      failProbe('npmjs'),
      okProbe('npmmirror'),
      okProbe('github'),
      okProbe('raw-github'),
      okProbe('huggingface'),
      okProbe('gitee'),
      okProbe('proxy-7897'),
      okProbe('proxy-10809'),
    ]
    const recs = recommend(probes, { npmRegistry: 'https://registry.npmjs.org', pnpmRegistry: 'https://registry.npmjs.org', proxyEnv: null })
    expect(recs.some((r) => r.action === 'set-registry')).toBe(true)
    expect(recs.find((r) => r.action === 'set-registry')?.command).toContain(NPM_MIRROR)
  })

  it('recommends proxy when github fails and a local proxy responds', () => {
    const probes = [
      okProbe('npmjs'),
      okProbe('npmmirror'),
      failProbe('github'),
      okProbe('raw-github'),
      okProbe('huggingface'),
      okProbe('gitee'),
      okProbe('proxy-7897'),
      okProbe('proxy-10809'),
    ]
    const recs = recommend(probes, { npmRegistry: '', pnpmRegistry: '', proxyEnv: null })
    expect(recs.some((r) => r.action === 'use-proxy')).toBe(true)
  })

  it('returns no recommendations when everything is reachable', () => {
    const probes = PROBE_TARGETS.map((t) => okProbe(t.id, t.url))
    expect(recommend(probes, { npmRegistry: '', pnpmRegistry: '', proxyEnv: null })).toEqual([])
  })

  it('suggests verifying an existing proxy env when github is still unreachable', () => {
    const probes = [okProbe('npmjs'), okProbe('npmmirror'), failProbe('github'), okProbe('gitee'), okProbe('huggingface'), okProbe('raw-github'), failProbe('proxy-7897'), failProbe('proxy-10809')]
    const recs = recommend(probes, { npmRegistry: '', pnpmRegistry: '', proxyEnv: 'http://127.0.0.1:7890' })
    expect(recs.some((r) => r.action === 'reuse-proxy-env')).toBe(true)
  })
})

describe('buildScript', () => {
  it('includes mirror and proxy commands when recommended', () => {
    const config: RegistryConfig = { npmRegistry: '', pnpmRegistry: '', proxyEnv: null }
    const script = buildScript([
      { action: 'set-registry', command: `pnpm config set registry ${NPM_MIRROR}`, reason: 'x' },
      { action: 'use-proxy', command: 'export HTTPS_PROXY=http://127.0.0.1:7897', reason: 'y' },
    ], config)
    expect(script).toContain(`pnpm config set registry ${NPM_MIRROR}`)
    expect(script).toContain('HTTPS_PROXY=http://127.0.0.1:7897')
  })

  it('emits a no-op note when nothing is needed', () => {
    const script = buildScript([], { npmRegistry: '', pnpmRegistry: '', proxyEnv: null })
    expect(script).toContain('No bootstrap actions needed')
  })
})

describe('cnBoot', () => {
  it('is read-only by default (no config writes) and reports ok when everything is reachable', async () => {
    const map: Record<string, boolean> = {}
    for (const t of PROBE_TARGETS) map[t.url] = true
    const calls: string[][] = []
    const result = await cnBoot({}, {
      fetchImpl: fetchMock(map),
      execImpl: (cmd, args) => { calls.push([cmd, ...args]); return { status: 0, stdout: '' } },
      env: { HOME: '/tmp', USERPROFILE: '/tmp' },
      home: '/tmp',
      now: () => 0,
    })
    expect(result.schema).toBe('dsh-cn-boot/v1')
    expect(result.ok).toBe(true)
    expect(result.probes.every((p) => p.ok)).toBe(true)
    expect(result.recommendations).toEqual([])
    expect(calls.some((call) => call.includes('set'))).toBe(false)
  })

  it('recommends actions when npmjs is unreachable and applies only with apply=true', async () => {
    const map: Record<string, boolean> = {}
    for (const t of PROBE_TARGETS) {
      map[t.url] = !(t.id === 'npmjs' || t.id === 'github')
    }
    const calls: string[][] = []
    const deps: BootDeps = {
      fetchImpl: fetchMock(map),
      execImpl: (cmd, args) => { calls.push([cmd, ...args]); return { status: 0, stdout: '' } },
      env: { HOME: '/tmp', USERPROFILE: '/tmp' },
      home: '/tmp',
      now: () => 0,
    }

    const readOnly = await cnBoot({}, deps)
    expect(readOnly.ok).toBe(false)
    expect(readOnly.recommendations.length).toBeGreaterThan(0)
    expect(calls.some((call) => call.includes('set'))).toBe(false)

    const applied = await cnBoot({ apply: true }, deps)
    expect(applied.applied.length).toBeGreaterThan(0)
    expect(applied.applied.every((a) => a.ok)).toBe(true)
    expect(calls.some(([cmd]) => cmd === 'pnpm')).toBe(true)
  })
})
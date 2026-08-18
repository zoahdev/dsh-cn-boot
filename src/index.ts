/**
 * dsh-cn-boot — China-network bootstrap for DeepSeek Harness.
 * @module dsh-cn-boot
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createRequire } from 'node:module'
import { satisfiesCaret } from './version.js'
import { cnBoot, type BootResult } from './boot.js'

export const name = 'dsh-cn-boot'

export const inject = ['tools']

export const TESTED_PEER_RANGE = '^0.1.0-rc.6'

const require = createRequire(import.meta.url)

export function resolvedDshToolsVersion(): string {
  try {
    const pkg = require('@deepseek-ai/dsh-tools/package.json') as { version?: string }
    return pkg.version ?? 'unknown'
  } catch {
    return 'unresolved'
  }
}

export function assertPeerCompatible(): void {
  const version = resolvedDshToolsVersion()
  if (!satisfiesCaret(version, TESTED_PEER_RANGE)) {
    throw new Error(
      `dsh-cn-boot: resolved @deepseek-ai/dsh-tools ${version}, but this plugin is tested with `
      + `${TESTED_PEER_RANGE}. Upgrade DeepSeek Harness to 0.1.0-rc.6 or later, then reinstall this plugin.`,
    )
  }
}

export interface Config {
  apply?: boolean
  timeoutMs?: number
}

export const Config: Schema<Config> = Schema.object({
  apply: Schema.boolean().default(false),
  timeoutMs: Schema.number().min(1000).max(30_000).default(5000),
})

export function renderResult(result: BootResult): string[] {
  const lines: string[] = []
  lines.push(`dsh-cn-boot ${result.ok ? 'OK' : 'RECOMMENDS ACTIONS'} — ${result.probes.filter((p) => p.ok).length}/${result.probes.length} targets reachable`)
  for (const probe of result.probes) {
    lines.push(`- [${probe.ok ? 'OK' : 'FAIL'}] ${probe.name}: ${probe.detail}`)
  }
  if (result.recommendations.length > 0) {
    lines.push('Recommendations:')
    for (const rec of result.recommendations) {
      lines.push(`- ${rec.action}: ${rec.reason}`)
      if (rec.command !== null) lines.push(`    ${rec.command}`)
    }
  }
  if (result.applied.length > 0) {
    lines.push('Applied:')
    for (const item of result.applied) {
      lines.push(`- ${item.action} ${item.ok ? 'OK' : 'FAILED'}: ${item.detail}`)
    }
  }
  return lines
}

export function apply(ctx: Context, config: Config): void {
  assertPeerCompatible()
  ctx.tools.register(defineTool({
    name: 'cn_boot',
    description:
      'Diagnose China-network connectivity for DeepSeek Harness: probe npm registry, npmmirror, GitHub, '
      + 'Hugging Face, Gitee and local proxies; read current npm/pnpm registry config; recommend mirrors or '
      + 'proxy usage; generate a bootstrap script. Read-only by default — pass options.apply=true to set the '
      + 'npm/pnpm registry to npmmirror (an explicit side effect).',
    parameters: {
      options: {
        type: 'object',
        additionalProperties: true,
        description: 'Boot options (apply/timeoutMs)',
        properties: {
          apply: { type: 'boolean' },
          timeoutMs: { type: 'number' },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          schema: { type: 'string' },
          ok: { type: 'boolean' },
          probes: { type: 'array' },
          config: { type: 'object', additionalProperties: true },
          recommendations: { type: 'array' },
          script: { type: 'string' },
          applied: { type: 'array' },
          warnings: { type: 'array' },
        },
      },
      render: (_args, value) => renderResult(value as BootResult).map((text) => ({ type: 'text' as const, text })),
    },
    async execute(args, _exec): Promise<BootResult> {
      return cnBoot({
        apply: args.options?.apply ?? config.apply,
        timeoutMs: args.options?.timeoutMs ?? config.timeoutMs,
      })
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'China-network bootstrap',
      kind: 'other',
      rawInput: args,
    }),
  }))
}
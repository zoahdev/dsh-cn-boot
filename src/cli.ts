/**
 * CLI entry for dsh-cn-boot.
 *   dsh-cn-boot [--apply] [--json] [--timeout <ms>]
 * Exit: 0 ok, 1 recommendations, 2 usage/IO error.
 */

import { cnBoot } from './boot.js'

interface Options {
  apply: boolean
  json: boolean
  timeoutMs: number
}

function usage(): string {
  return [
    'dsh-cn-boot — China-network bootstrap for DeepSeek Harness',
    '',
    'Usage:',
    '  dsh-cn-boot [--apply] [--json] [--timeout <ms>]',
    '',
    'Options:',
    '  --apply         set npm/pnpm registry to npmmirror if recommended (explicit side effect)',
    '  --json          print the machine-readable result',
    '  --timeout <ms>  per-probe timeout in milliseconds (default 5000)',
    '  --help          show this help',
  ].join('\n')
}

function parseArgs(argv: string[]): Options | { help: true } | { error: string } {
  const options: Options = { apply: false, json: false, timeoutMs: 5000 }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--help': case '-h': return { help: true }
      case '--apply': options.apply = true; break
      case '--json': options.json = true; break
      case '--timeout':
        options.timeoutMs = Number(argv[++i])
        if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1000) return { error: '--timeout requires a number >= 1000' }
        break
      default:
        return { error: `unknown option: ${arg}` }
    }
  }
  return options
}

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv)
  if ('help' in parsed) { process.stdout.write(usage() + '\n'); return 0 }
  if ('error' in parsed) { process.stderr.write(parsed.error + '\n\n' + usage() + '\n'); return 2 }
  try {
    const result = await cnBoot({ apply: parsed.apply, timeoutMs: parsed.timeoutMs })
    if (parsed.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } else {
      const lines = [
        `dsh-cn-boot ${result.ok ? 'OK' : 'RECOMMENDS ACTIONS'} — ${result.probes.filter((p) => p.ok).length}/${result.probes.length} targets reachable`,
      ]
      for (const probe of result.probes) {
        lines.push(`[${probe.ok ? 'OK' : 'FAIL'}] ${probe.name}: ${probe.detail}`)
      }
      for (const rec of result.recommendations) {
        lines.push(`! ${rec.action}: ${rec.reason}`)
        if (rec.command !== null) lines.push(`  ${rec.command}`)
      }
      if (result.applied.length > 0) {
        for (const item of result.applied) lines.push(`applied: ${item.action} ${item.ok ? 'OK' : 'FAILED'} (${item.detail})`)
      }
      process.stdout.write(lines.join('\n') + '\n\n' + result.script + '\n')
    }
    return result.ok ? 0 : 1
  } catch (error) {
    process.stderr.write(`dsh-cn-boot: ${String(error instanceof Error ? error.message : error)}\n`)
    return 2
  }
}
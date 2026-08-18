#!/usr/bin/env node
/**
 * Packaged integration + real runtime invocation smoke test.
 * Installs the packed tarball, loads the bundle, registers cn_boot,
 * executes it (real network probes, bounded), and asserts the envelope.
 */

import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tgz = path.resolve(process.argv[2] ?? path.join(root, 'dsh-cn-boot-0.1.0.tgz'))

if (!existsSync(tgz)) {
  console.error(`[integration] missing tarball: ${tgz}`)
  process.exit(1)
}

function runPnpm(args, cwd) {
  if (process.platform === 'win32') {
    return spawnSync(`pnpm ${args.join(' ')}`, { cwd, stdio: 'inherit', shell: true })
  }
  return spawnSync('pnpm', args, { cwd, stdio: 'inherit' })
}

async function scenario(name, dshToolsVersion, expectGuard) {
  const dir = mkdtempSync(path.join(tmpdir(), `dsh-cn-boot-${name}-`))
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-cn-boot-integration-host', private: true, version: '1.0.0',
    dependencies: {
      '@deepseek-ai/cordis': '^4.0.1',
      '@deepseek-ai/dsh-tools': dshToolsVersion,
      '@deepseek-ai/schemastery': '^3.18.1',
      'dsh-cn-boot': `file:${tgz.replaceAll('\\', '/')}`,
    },
  }, null, 2))

  console.log(`[integration:${name}] installing packed tarball (dsh-tools ${dshToolsVersion})...`)
  const install = runPnpm(['install'], dir)
  if (install.status !== 0) { console.error(`[integration:${name}] pnpm install failed`); process.exit(1) }

  const pluginIndex = path.join(dir, 'node_modules', 'dsh-cn-boot', 'lib', 'index.js')
  if (!existsSync(pluginIndex)) throw new Error('packed plugin entry lib/index.js missing after install')

  const plugin = await import(pathToFileURL(pluginIndex).href)
  if (plugin.name !== 'dsh-cn-boot') throw new Error(`unexpected plugin name: ${plugin.name}`)

  const registered = []
  const ctx = { tools: { register: (definition) => { registered.push(definition); return () => {} } } }

  if (expectGuard) {
    let threw = false
    try { plugin.apply(ctx, { apply: false, timeoutMs: 5000 }) } catch (error) {
      threw = true
      if (!String(error instanceof Error ? error.message : error).includes('tested with ^0.1.0-rc.6')) {
        throw new Error(`guard threw an unexpected error: ${String(error)}`)
      }
    }
    if (!threw) throw new Error('runtime guard did not reject the incompatible dsh-tools version')
    console.log(`PASS [${name}] runtime guard rejected @deepseek-ai/dsh-tools ${dshToolsVersion}`)
    rmSync(dir, { recursive: true, force: true })
    return
  }

  plugin.apply(ctx, { apply: false, timeoutMs: 1500 })
  const tool = registered.find((definition) => definition.name === 'cn_boot')
  if (tool === undefined) throw new Error('cn_boot tool was not registered')

  console.log(`[integration:${name}] executing the real cn_boot handler (bounded probes)...`)
  const result = await tool.execute({ options: { timeoutMs: 1500 } }, { signal: new AbortController().signal })
  if (result?.schema !== 'dsh-cn-boot/v1') throw new Error(`unexpected canonical result: ${JSON.stringify(result)}`)
  if (!Array.isArray(result.probes) || result.probes.length < 6) {
    throw new Error(`probes missing: ${JSON.stringify(result.probes)}`)
  }

  const blocks = tool.output.render({}, result)
  const text = blocks.map((block) => block.text ?? '').join('\n')
  if (!text.includes('targets reachable')) throw new Error(`render output missing summary: ${JSON.stringify(text)}`)

  console.log(`PASS [${name}] packed artifact loaded, cn_boot registered, handler executed, render asserted (${result.probes.length} probes)`)
  rmSync(dir, { recursive: true, force: true })
}

await scenario('happy', '0.1.0-rc.6', false)
await scenario('guard', '0.1.0-rc.3', true)
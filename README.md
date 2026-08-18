# dsh-cn-boot

[![CI](https://github.com/zoahdev/dsh-cn-boot/actions/workflows/ci.yml/badge.svg)](https://github.com/zoahdev/dsh-cn-boot/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dsh-plugin](https://img.shields.io/badge/dsh--plugin-verified-blue)](https://github.com/topics/dsh-plugin)

China-network bootstrap for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh): one command that tells you **why installs are slow or broken** and what to do about it.

It probes the endpoints that matter to a dsh user in mainland China — npm registry, npmmirror, GitHub, raw.githubusercontent, Hugging Face, Gitee — plus common local proxy ports (127.0.0.1:7897 / 10809), reads your current npm/pnpm registry config, and returns concrete recommendations plus a copy-paste bootstrap script. **Read-only by default**; `apply` is an explicit opt-in that only sets the npm/pnpm registry to npmmirror.

## Install

```sh
dsh plugin add dsh-cn-boot
```

Or run standalone:

```sh
npx dsh-cn-boot
```

## CLI

```sh
dsh-cn-boot [--apply] [--json] [--timeout <ms>]
```

- Prints probe results, recommendations and a PowerShell + bash bootstrap script.
- `--apply` runs `pnpm config set registry https://registry.npmmirror.com` (and npm) when recommended — the only side effect.
- Exit codes: `0` connectivity looks fine, `1` recommendations, `2` usage error.

```sh
npx dsh-cn-boot
npx dsh-cn-boot --apply
npx dsh-cn-boot --json
```

## In-harness usage (agent-callable)

Ask your dsh agent:

> 检查一下我的网络连 dsh 依赖源通不通，给个引导建议。
> Run a China-network bootstrap check: `cn_boot`.

The tool returns a `dsh-cn-boot/v1` result: per-target probe results, current registry config, recommendations, a generated script, and (only with `options.apply: true`) what was applied.

## Checks

| Probe | Why |
|---|---|
| `registry.npmjs.org/-/ping` | official npm registry reachability |
| `registry.npmmirror.com/-/ping` | the standard China mirror |
| `github.com` | dsh source installs / docs |
| `raw.githubusercontent.com` | raw file downloads |
| `huggingface.co` | model/asset downloads |
| `gitee.com` | domestic fallback |
| `127.0.0.1:7897` / `127.0.0.1:10809` | common local proxy ports (Clash / V2Ray) |

## Why it exists

- The most common first-hour failure for dsh users in China is a network one: `pnpm dlx @deepseek-ai/dsh` hangs or ERESOLVE, GitHub clones time out, `raw.githubusercontent.com` is unreachable.
- Existing tools tell you *something is broken*; this one tells you *what* and *what to run next* — mirror registry, proxy env, or nothing at all.
- Zero runtime dependencies, read-only by default, and the apply path is a single, explicit, reversible registry setting.

## Development

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm test:integration
```

CI runs the dsh-plugin-doctor preflight, unit tests, packed-artifact integration (real `cn_boot` invocation), and a fresh-profile `dsh web` boot smoke on Windows.

## License

MIT © 2026 zoahdev

---

# dsh-cn-boot（中文）

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的**国内网络引导插件**：一条命令告诉你安装为什么慢/坏，以及该怎么做。

它探测国内 dsh 用户最关心的端点——npm 官方源、npmmirror、GitHub、raw.githubusercontent、Hugging Face、Gitee——以及常见本地代理端口（127.0.0.1:7897 / 10809），读取当前 npm/pnpm 注册表配置，返回具体建议和一份可直接复制的引导脚本（PowerShell + bash）。**默认只读**；`apply` 是显式开关，唯一副作用是把 npm/pnpm 注册表设为 npmmirror。

## 安装

```sh
dsh plugin add dsh-cn-boot
```

独立使用：

```sh
npx dsh-cn-boot
```

## CLI

```sh
dsh-cn-boot [--apply] [--json] [--timeout <ms>]
```

- 输出探测结果、建议和 PowerShell + bash 引导脚本。
- `--apply` 在推荐时执行 `pnpm config set registry https://registry.npmmirror.com`（以及 npm）——唯一的副作用。
- 退出码：`0` 网络正常，`1` 有建议，`2` 用法错误。

```sh
npx dsh-cn-boot
npx dsh-cn-boot --apply
npx dsh-cn-boot --json
```

## 在 harness 内使用（agent 可调用）

对 agent 说：

> 检查一下我的网络连 dsh 依赖源通不通，给个引导建议。

工具返回 `dsh-cn-boot/v1` 结果：各目标探测结果、当前注册表配置、建议、生成脚本，以及（仅当 `options.apply: true` 时）已执行的操作。

## 为什么需要它

- 国内 dsh 用户第一小时的失败大多是网络问题：`pnpm dlx @deepseek-ai/dsh` 卡住或 ERESOLVE、GitHub clone 超时、raw.githubusercontent 不通。
- 现有工具只告诉你“坏了”；这个插件告诉你“哪里坏、下一步跑什么”——换镜像、走代理，或者什么都不用动。
- 零运行时依赖、默认只读，apply 路径是单一、显式、可逆的注册表设置。

## 开发

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm test:integration
```

CI 跑 dsh-plugin-doctor 预检、单元测试、打包集成（真实 `cn_boot` 调用）、Windows 全新 profile 的 `dsh web` 启动冒烟。

## 许可证

MIT © 2026 zoahdev
## Related ecosystem tools

- [dsh-dep-audit](https://github.com/zoahdev/dsh-dep-audit) - dependency supply-chain hygiene
- [dsh-quality-score](https://github.com/zoahdev/dsh-quality-score) - plugin quality scorecard + full-registry leaderboard
- [dsh-ecosystem](https://github.com/zoahdev/dsh-ecosystem) - health scan, impact, trend, live dashboard
- [dsh-tutorials](https://github.com/zoahdev/dsh-tutorials) - bilingual plugin pipeline tutorials


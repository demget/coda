# Coda

Coda is an "agent harness control surface". It enables control of the agents on your machine from a web, desktop, or mobile client.

Works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, and OpenCode. If they're set up on your computer, Coda can control them.

> [!NOTE]
> Coda is a fork of [T3 Code](https://github.com/pingdotgg/t3code). It is not published to any
> package registry — you run it from this checkout. It keeps its own identity everywhere it
> touches your machine, so it can run side by side with an installed T3 Code:
>
> |                        | T3 Code               | Coda                    |
> | ---------------------- | --------------------- | ----------------------- |
> | Data directory         | `~/.t3`               | `~/.coda`               |
> | Environment variables  | `T3CODE_*`            | `CODA_*`                |
> | Desktop bundle ID      | `com.t3tools.t3code`  | `com.coda.app`          |
> | Deep-link scheme       | `t3code://`           | `coda://`               |
> | Checkpoint git refs    | `refs/t3/checkpoints` | `refs/coda/checkpoints` |
> | Worktree branch prefix | `t3code/`             | `coda/`                 |
> | CLI binary             | `t3`                  | `coda`                  |

## Running it

> [!WARNING]
> Coda currently supports Codex, Claude, Cursor, Grok Build and OpenCode. Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
> - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`

Install the toolchain and dependencies (see [Install `vp`](#install-vp) below), then:

```bash
vp i                 # install dependencies
vp run dev           # server + web app, hot-reloading
vp run dev:desktop   # Electron shell instead of the browser
```

The `[dev-runner]` line printed at startup tells you the real ports and data directory. The web app
requires pairing — open the pairing URL it prints, not the bare origin.

## Some notes

We are very very early in this project. Expect bugs.

We are (mostly) not accepting contributions yet. Small fixes may be considered. Big features will not be.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- Linux: [run Coda as a background service](./docs/user/background-service.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## If you REALLY want to contribute still.... read this first

### Install `vp`

Coda uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).

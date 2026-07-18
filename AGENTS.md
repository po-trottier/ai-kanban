# Agent instructions — rivian-kanban

The canonical, harness-agnostic instructions live in **`.agents/INSTRUCTIONS.md`** — read it first and
treat it as the source of truth. This file only adds Codex-specific setup.

@.agents/INSTRUCTIONS.md

## Codex specifics

- **MCP servers**: defined in `.codex/config.toml` (`[mcp_servers.*]`). Codex loads project-scoped
  config only for **trusted** projects — trust this directory on first run (or set
  `[projects."<path>"]` `trust_level = "trusted"` in `~/.codex/config.toml`).
- Codex reads this `AGENTS.md` from the repo root automatically and concatenates it down the tree. The
  `@import` line above is honored by harnesses that support it; the directive above covers those that
  do not, so both paths land on `.agents/INSTRUCTIONS.md`.

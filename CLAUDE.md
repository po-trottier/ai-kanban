# Claude Code — rivian-kanban

@.agents/INSTRUCTIONS.md

## Claude Code specifics

- **MCP servers**: project servers are in `.mcp.json`, pre-approved for the team in
  `.claude/settings.json` (`enableAllProjectMcpServers`). Personal servers stay in `~/.claude.json`.
- **Skills**: `.claude/skills/` (symlinks to the canonical copies in `.agents/skills/`).
- **Local overrides**: `.claude/settings.local.json` (gitignored — machine-specific only).

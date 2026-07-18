# Skills (canonical)

Agent **skills** — reusable task packages (a `SKILL.md` plus optional assets) — live here as the
single source of truth. Each harness (`.claude/skills/`, …) symlinks to these copies, so a skill is
defined once and shared, with no duplication.

Manage them with the [`vercel-labs/skills`](https://github.com/vercel-labs/skills) CLI:

```bash
npx skills add <github-repo> --skill <name>   # installs into .agents/skills/, symlinks per harness
npx skills list
```

Recommended for this repo — add when the work calls for it; keep the set lean (knip-style, no
speculative installs):

- **`mantinedev/skills` → `mantine-custom-components`** — building Mantine 9 UI:
  `npx skills add https://github.com/mantinedev/skills --skill mantine-custom-components`

Before writing against any library, fetch its `llms-full.txt` for exact APIs — see the table in
`docs/dev/getting-started.md` → "AI-assisted development".

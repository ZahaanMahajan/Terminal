# Terminal

A solo, learning-first systems project: build a terminal ecosystem — renderer, parser, shell,
compiler, PTY, persistence — from primitives, mastering every layer.

> Not a startup. Not a SaaS. A self-taught senior-engineer curriculum disguised as a terminal
> ecosystem. _Build engines before products. Understand every layer._

## Where to start

- **[SKILLS.md](./SKILLS.md)** — living index, phase status, key decisions, deferred items.
- **[docs/PLANNING_AND_ARCHITECTURE.md](./docs/PLANNING_AND_ARCHITECTURE.md)** — the full roadmap
  (philosophy, six phases, evolution-over-years).

## Current phase

**Phase 1 — Terminal Rendering Engine.** See `apps/web/src/renderer/README.md`.

## Run it

```bash
cd apps/web
npm install     # only the first time
npm run dev     # starts Vite on http://localhost:5173
```

## Repo shape

```
.
├─ apps/
│  └─ web/              # Vite + React + TS — the studio + terminal
│     └─ src/
│        ├─ renderer/   # Phase 1 (active)
│        ├─ input/      # Phase 2 (reserved)
│        ├─ shell/      # Phase 3 (reserved)
│        ├─ studio/     # Phase 4 UI (reserved)
│        └─ persistence/ # localStorage/IndexedDB (reserved)
├─ packages/            # arrives with Phase 4 (config compiler)
├─ services/            # arrives with Phase 5/6 (PTY + persistence backend)
└─ docs/
   ├─ PLANNING_AND_ARCHITECTURE.md
   ├─ ADRs/             # (planned)
   └─ notes/            # (planned)
```

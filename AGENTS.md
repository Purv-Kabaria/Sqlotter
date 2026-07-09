# Sqlotter Development Guide

Sqlotter is a Factory-Balls-style stencil-painting puzzle built as a Devvit Web app for Reddit. Players reproduce a goal pattern by wearing accessories as paint stencils in the right order, earn Sparks, solve the daily Sqlot, customize the Splot mascot, and publish community levels.

## Stack

- Client: Phaser 4, Vite, TypeScript
- Server: Hono in the Devvit Node.js 22 serverless runtime
- Platform: `@devvit/web` and `@devvit/start`
- Persistence: Devvit Redis
- Client/server API: typed REST requests under `/api`

There is no React or tRPC setup in this repository. Do not introduce either unless the architecture is deliberately migrated end-to-end.

## Repository Layout

- `src/client`: iframe code. `splash.ts` is the lightweight inline feed view; `game.ts` starts the expanded Phaser game.
- `src/client/scenes`: one Phaser scene per screen.
- `src/client/components`: reusable Phaser renderers for slimes and the mascot.
- `src/client/engine`: deterministic puzzle rules and scoring helpers.
- `src/server`: secure Hono routes running in Devvit.
- `src/shared`: dependency-free types, API contracts, curated levels, and daily generation shared by client and server.
- `public/assets`: game sprites loaded by `Preloader.ts`.
- `devvit.json`: client/server entrypoints and all platform menu, trigger, and scheduler mappings.

## Devvit Rules

- Access `redis`, `reddit`, `context`, `scheduler`, and `realtime` only from `@devvit/web/server` in server code.
- Use `requestExpandedMode`, `navigateTo`, `showToast`, and other browser-safe APIs from `@devvit/web/client`.
- Do not import Blocks or `@devvit/public-api`; this is Devvit Web only.
- Do not use `window.location`, `window.assign`, `window.alert`, or persistent `localStorage`.
- Keep `splash.html` fast and free of Phaser imports.
- Keep scripts in separate TypeScript files; do not add inline scripts to HTML.
- Register every new internal menu, form, trigger, or scheduler endpoint in `devvit.json`.

## Game Invariants

- The shared simulation (`src/shared/slimeSim.ts`) is the single rulebook; client, server, and renderer all replay the same action lists through it. Never fork the rules.
- Win = the painted pattern matches the goal replay AND nothing is worn (`isCleanMatch`).
- The goal IS a replay: `optimalSolution` over the level palette produces the goal pattern; no goal state is stored.
- Goggles break when a splash lands on them (automatic, free, unwearable until reset). All other stencils toggle freely — there are no slot conflicts.
- Every logged action costs one step, including Reset (which restores broken goggles but keeps the clock and count running).
- The server is authoritative for levels, completion validation, rewards, purchases, and equipment.
- Never trust client-provided stars, rewards, ownership, prices, or optimal-step values.
- Keep the goal visible, the step counter and timer available, and reset always accessible.
- Use `pointerup` for actions and maintain at least 44 by 44 CSS-pixel touch targets.

## Data And API Conventions

- Put request and response types in `src/shared/api.ts`.
- Put shared domain types in `src/shared/types.ts`.
- Redis keys use colon-separated namespaces.
- Redis values are strings; parse reads and stringify structured writes.
- Bound user-controlled strings and collection sizes before storing them.
- Return explicit 4xx errors for invalid input and authentication failures.
- Prefer typed parsing helpers over TypeScript casts for untrusted JSON.

## Code Style

- TypeScript is strict. Do not use `any` or add type casts.
- Prefer type aliases and named exports.
- Keep client/server boundaries intact; shared modules must not depend on Phaser or Devvit runtime APIs.
- Use `void (async () => { ... })()` for fire-and-forget Phaser handlers.
- Add comments only for non-obvious rules or platform constraints.
- Preserve the existing responsive scene patterns and asset key conventions.

## Verification

Run these before committing:

```text
npm run type-check
npm run lint
npm run build
```

Use `npm run dev` for Devvit playtesting after authenticating with `npm run login`. Verify portrait mobile, landscape tablet, and desktop layouts. Test the complete path for every feature: client interaction, API validation, Redis mutation, reload behavior, and failure feedback.

## Launch Checklist

- Inline splash opens the `game` expanded entrypoint.
- Curated, daily, and community levels load and complete correctly.
- Completion rewards cannot be forged or farmed by replaying.
- Leaderboards retain only each player's best valid score.
- Shop purchases are server-priced; equipment requires ownership.
- Community level creation validates solvability and appears in discovery.
- Scheduler, install trigger, and moderator menu endpoints match `devvit.json`.
- Type check, lint, production build, and Devvit playtest pass.

# Workspace Environment and Verification

This workspace is verified as a pre-release alpha (`0.1.0-alpha.x`) with:

- Node.js `24.8.0`
- pnpm `10.33.0`
- TypeScript `5.4.5`

## Reproducible local gates

Run these from a clean checkout at the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm test:architecture
pnpm test:adversarial
pnpm bench
pnpm pack:verify
```

## Notes

- `pnpm build` is intentionally sequenced: `@eregister/wit-grid-core` must build before `@eregister/wit-grid-react` because the React package compiles against the core `dist` entrypoints.
- `pnpm bench` runs the committed instrumentation-budget evidence in `packages/core/src/perf/instrumentedBudgets.test.ts`.
- `pnpm pack:verify` packs both published packages, installs them into `fixtures/package-consumer`, and compiles the fixture as an external consumer.

# Plan 033: Reconcile implemented backlog items and verify the release gates

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report rather than improvising. When done, update the status row for this
> plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 54d4803..HEAD -- plans/README.md packages/core/src packages/react/src demo/src package.json demo/package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" notes against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P0
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `54d4803`, 2026-06-13

## Why this matters

The plan backlog has drifted behind the code. `plans/README.md` still marks
completed work as `TODO`, which makes it hard to tell what remains and risks
sending the next implementation pass after already-landed items.

This plan does not add new product behavior. It verifies the stale backlog
entries against the current tree, runs the core release gates, and updates the
plan index so future work starts from an accurate baseline.

## Current state

Relevant files and roles:

- `plans/README.md` - plan index; still marks `001`, `028`, and `032` as `TODO`
- `packages/core/src/store.test.ts` - contains row multi-select coverage
- `demo/src/pages/RowMultiSelectDemo.tsx` - live demo proving the feature is
  wired into the product surface
- `packages/react/src/index.ts` - public React barrel; already exports `Grid`
  as the grid entrypoint
- `packages/core/src/engine/architectureGuards.test.ts` - architecture guard
  coverage for the single-grid public surface and demo import boundaries

Live excerpts that the executor should confirm before updating any status:

- `plans/README.md:5` still lists `001-row-multiselect` as `TODO`
- `plans/README.md:32` still lists `028-public-react-surface-hardening` as `TODO`
- `plans/README.md:36` still lists `032-single-grid-entrypoint-lockdown` as `TODO`
- `packages/core/src/store.test.ts:1663` begins the `selectedRowIds is empty by default` test block
- `demo/src/pages/RowMultiSelectDemo.tsx:1` starts the row multi-select demo and documents the API surface
- `packages/react/src/index.ts:1` exports `Grid`
- `packages/core/src/engine/architectureGuards.test.ts:346` asserts React exposes `Grid` as the only public grid entrypoint

Repo conventions to follow:

- Plans are tracked directly in `plans/README.md` with short status notes in
  the `Notes` section when a plan is implemented or superseded.
- The repo already records implemented plan outcomes in prose notes near the
  bottom of `plans/README.md`; match that style instead of inventing a new
  tracking format.

## Commands you will need

| Purpose          | Command                                                   | Expected on success                |
| ---------------- | --------------------------------------------------------- | ---------------------------------- |
| Core build       | `corepack pnpm --filter @eregister/open-grid-core build`  | exit 0                             |
| Core tests       | `corepack pnpm --filter @eregister/open-grid-core test`   | exit 0, all tests pass             |
| React build      | `corepack pnpm --filter @eregister/open-grid-react build` | exit 0                             |
| React tests      | `corepack pnpm --filter @eregister/open-grid-react test`  | exit 0, all tests pass             |
| Demo build       | `corepack pnpm --filter demo-app build`                   | exit 0                             |
| Dirty tree check | `git status --short`                                      | only expected local changes remain |

## Scope

**In scope**:

- `plans/033-plan-reconciliation-and-release-hardening.md`
- `plans/README.md`

**Out of scope**:

- Feature work in `packages/core/src`, `packages/react/src`, or `demo/src`
- Any source edit made only to "make the build green"
- Rewriting old plan files unless a status note in `plans/README.md` is not enough

## Git workflow

- Stay on the current branch
- Use the repo's existing short descriptive plan-note style
- Do NOT push or create a PR

## Steps

### Step 1: Verify the stale plan findings against the live tree

Confirm that `001` is genuinely implemented by checking for row multi-select
tests and a live demo surface. Confirm that `032` is genuinely implemented by
checking the React barrel and architecture guards. Confirm whether `028` was
completed independently or superseded by the later `029`/`030`/`032` sequence.

If `028`'s intent is already satisfied by the later single-`Grid` work, mark
it `REJECTED` with a one-line rationale that it was superseded by later plans
rather than silently calling it `DONE`.

**Verify**: `git status --short` -> no unexpected source edits are needed to
support the status decision.

### Step 2: Run the release gates from the current tree

Run the core, React, and demo verification commands exactly as listed in the
command table. Do not update plan statuses until these gates pass, because the
point of this plan is to reconcile the backlog against a verifiable baseline.

If one of these commands fails because of an existing code issue, stop and
report that failure instead of editing source. The next action in that case is
to write a new implementation plan for the failing area, not to force this
reconciliation plan through.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0
- `corepack pnpm --filter @eregister/open-grid-core test` -> exit 0
- `corepack pnpm --filter @eregister/open-grid-react build` -> exit 0
- `corepack pnpm --filter @eregister/open-grid-react test` -> exit 0
- `corepack pnpm --filter demo-app build` -> exit 0

### Step 3: Reconcile `plans/README.md` from evidence

Update the status table so it matches the verified tree:

- `001` should move to `DONE` if the row multi-select tests and demo evidence are present
- `032` should move to `DONE` if the React barrel and demo guard evidence are present and the release gates pass
- `028` should become `REJECTED` if its work was absorbed by the later `029`/`030`/`032` sequence, with a short rationale in the notes
- `033` should be added to the status table and marked `DONE` once this reconciliation run finishes

Add short notes near the bottom of `plans/README.md` summarizing the evidence
used for each status change so the next pass does not need to rediscover it.

**Verify**: `git diff -- plans/README.md` -> shows only the intended status and note updates.

## Test plan

- No new source tests
- Verification is the existing build/test matrix plus manual evidence checks in:
  `packages/core/src/store.test.ts`
  `demo/src/pages/RowMultiSelectDemo.tsx`
  `packages/react/src/index.ts`
  `packages/core/src/engine/architectureGuards.test.ts`

## Done criteria

Machine-checkable. All must hold:

- [ ] `corepack pnpm --filter @eregister/open-grid-core build` exits 0
- [ ] `corepack pnpm --filter @eregister/open-grid-core test` exits 0
- [ ] `corepack pnpm --filter @eregister/open-grid-react build` exits 0
- [ ] `corepack pnpm --filter @eregister/open-grid-react test` exits 0
- [ ] `corepack pnpm --filter demo-app build` exits 0
- [ ] `plans/README.md` no longer shows stale `TODO` statuses for `001` and `032`
- [ ] `plans/README.md` records an explicit disposition for `028`
- [ ] No files outside `plans/` are modified

## STOP conditions

Stop and report back if:

- The code at the locations in "Current state" no longer matches the cited evidence
- Any build or test command fails
- Reconciling `028` would require source edits to prove the earlier API split work
- Updating the plan index would require rewriting old plan files rather than a status and notes refresh

## Maintenance notes

- Future plan reviews should treat `plans/README.md` as a living execution index and reconcile it whenever a later implementation overtakes an earlier plan.
- If a future plan is satisfied by later work rather than landed directly, prefer `REJECTED` with a short rationale over leaving a misleading `TODO`.

# CI Gate Runbook

## Gate Definition
The `quality-gate` workflow is required for `main` and includes:
- `build_and_types`
- `smoke_public`
- `smoke_workspace`
- perf guardrail (`npm run perf:budget`) inside `build_and_types`

Any failed job blocks release until fixed or formally waived according to policy.
Branch protection is configured with `strict=true` and `enforce_admins=true`.

## Local Reproduction
Run in this order:

```bash
npm ci
npm run build
npm run perf:budget
npx tsc --noEmit
npm run test:smoke:public
npm run test:smoke:workspace
```

## Interpreting Failures
- `build_and_types` failed:
  - Type/import/build/perf-budget regression. Fix before merge.
- `smoke_public` failed:
  - Entry app availability/auth-gate visibility regressed.
- `smoke_workspace` failed:
  - Core workspace flow regressed (tabs, editor, monitor, assets, history, settings).

## Artifacts
On smoke failures, CI uploads:
- `playwright-report`
- `test-results`

Use traces and snapshots to identify selector/timing or functional regressions.

## Waiver Policy
- Emergency-only and time-limited.
- Allowed only for external-provider incidents affecting non-deterministic smoke paths.
- Must include:
  - incident/ticket reference,
  - root cause summary,
  - expiry date for waiver.
- Never waive `build_and_types`.

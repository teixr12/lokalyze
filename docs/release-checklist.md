# Lokalyze Release Checklist (Production Direct, Controlled)

## 1) Pre-Deploy (Go/No-Go Gate)
- [ ] Branch synced with `main`.
- [ ] CI `quality-gate` green for current commit (`build_and_types`, `smoke_public`, `smoke_workspace`).
- [ ] `npm run build` passed with no TypeScript errors.
- [ ] `npm run smoke:local` passed.
- [ ] `npm run test:smoke:all` passed (or explicitly waived with reason).
- [ ] Kill-switch variables are present in Vercel:
  - `VITE_UI_V2_ENABLED`
  - `VITE_UI_V2_CANARY_PERCENT`
  - `VITE_UI_V2_MONITOR`
  - `VITE_UI_V2_ASSETS`
  - `VITE_UI_V2_HISTORY`
- [ ] `VITE_DISABLE_FIREBASE_AUTH` is not set in production (test-only variable).
- [ ] No unresolved blocker in critical flows: auth, batch, monitor, assets, history, settings.

## 2) Deploy
- [ ] Deploy production to `teixr12s-projects/lokalyze-maynfrme`.
- [ ] Confirm alias points to latest deployment:
  - `https://lokalyze-maynfrme.vercel.app`

## 3) Post-Deploy (First 10 Minutes)
- [ ] `npm run smoke:prod` passed.
- [ ] Home responds `200`.
- [ ] No fatal runtime error path observed.
- [ ] Core tabs render (`workspace smoke` profile) or auth gate appears correctly (`public smoke` profile).
- [ ] If auth gate appears, sign-in button is visible and actionable.
- [ ] Deploy hygiene executed (keep last 2 production deployments).

## 4) Rollback Triggers
- [ ] Any core smoke check fails.
- [ ] Fatal client errors increase unexpectedly.
- [ ] Users report blocked core flow.

## 5) Immediate Rollback Actions
- [ ] Set `VITE_UI_V2_ENABLED=false` and redeploy.
- [ ] Or set module-specific fallback:
  - `VITE_UI_V2_MONITOR=false`
  - `VITE_UI_V2_ASSETS=false`
  - `VITE_UI_V2_HISTORY=false`
- [ ] Re-run `npm run smoke:prod`.

## 6) Release Sign-Off
- Date/Time (UTC):
- Deployment URL:
- Operator:
- Result: GO / ROLLBACK
- Notes:

## 7) CI Waiver Policy (Emergency Only)
- Allowed only for `smoke_workspace` when auth-provider outage is external and confirmed.
- Waiver requires reason and linked incident/ticket in PR.
- Waiver is never allowed for `build_and_types`.

# Analytics Shadow Mode (Internal + External)

## Goal
Validate external analytics delivery without replacing the internal source of truth.

## Configuration
- `VITE_ANALYTICS_EXTERNAL_V1=true`
- `VITE_POSTHOG_KEY=...`
- `VITE_POSTHOG_HOST=...`

## Behavior
- Adapter keeps dual-write: internal hook + PostHog provider.
- UI never blocks if external provider fails.
- Recommended production phase: use external dashboards as read-only until event drift is acceptable.

## Minimum drift checks
Compare 24h counts for:
- `batch_started`
- `job_completed`
- `job_failed`
- `first_value_action`

Target drift: `< 3%`.

## Rollback
1. Set `VITE_ANALYTICS_EXTERNAL_V1=false`.
2. Redeploy.
3. Internal analytics path remains active.


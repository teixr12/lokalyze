# Proxy Data Provider Rollout (Zero Regressao)

## Goal
Move `projects` cloud operations from browser-direct Supabase calls to backend proxy endpoints with Firebase token verification.

## Flags
- `VITE_DATA_PROVIDER=client|proxy`
- `VITE_DATA_PROVIDER_SHADOW_READ=true|false`
- `VITE_DATA_PROVIDER_FALLBACK_CLIENT=true|false`

## Recommended rollout
1. Deploy proxy code with `VITE_DATA_PROVIDER=client` (no behavior change).
2. Enable `VITE_DATA_PROVIDER=proxy` for canary users.
3. Keep `VITE_DATA_PROVIDER_SHADOW_READ=true` to compare client/proxy list counts.
4. Keep `VITE_DATA_PROVIDER_FALLBACK_CLIENT=false` unless there is an incident.
5. Promote to 100% only after multi-user isolation test passes.

## Validation checklist
1. User A creates, edits, deletes history entries.
2. User B cannot see A's project IDs via normal UI and direct URL guessing.
3. `npm run test:smoke:all` passes.
4. `npm run smoke:prod` passes.
5. No spike in `api_error` with source prefix `proxy_projects_`.

## Rollback
1. Set `VITE_DATA_PROVIDER=client`.
2. Redeploy.
3. Re-run `smoke:prod`.


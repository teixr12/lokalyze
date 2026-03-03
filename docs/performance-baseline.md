# Performance Baseline (Phase 3 Quick Wins)

## Baseline Capture
- Date: 2026-03-03
- Command: `npm run build`

## Build Output Snapshot
- CSS bundle: `~136.05 kB` (`~18.82 kB gzip`)
- JS chunk (small): `~15.14 kB` (`~5.22 kB gzip`)
- JS chunk (main): `~837.33 kB` (`~206.21 kB gzip`)

## Runtime Notes
- App is single-shell heavy (`index.tsx`) and sensitive to wide rerender.
- Monaco is lazily loaded, but main shell still carries substantial code.
- No list virtualization in this phase by design (risk deferred).

## Target for Next Iteration
- Keep core behavior identical.
- Reduce main JS chunk where feasible with additive splitting/memoization.
- Re-run smoke suite after each optimization commit.

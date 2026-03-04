# HiveVM Build Progress

## Status
- [x] Read `spec/spec.md`
- [x] Create repo-level `AGENTS.md`
- [x] Create `spec/progress.md`
- [x] Scaffold Bun+TypeScript CLI package
- [x] Implement DB schema + domain services
- [x] Implement host daemon + Docker runtime
- [x] Implement scheduler + placement logic
- [x] Implement metering + billing + payouts
- [x] Implement private pools + checkpoint/restore + reputation
- [x] Implement API server
- [x] Add tests and run full verify gate

## Completed Deliverables
- CLI package (`hive-vm`) with host + builder command surfaces
- SQLite-backed control plane with scheduler, market pricing, metering, billing, payouts
- Docker runtime adapter (v1 isolation) + mock runtime for deterministic tests
- Host daemon assignment execution loop with usage metering ticks
- Private compute pools and pool-constrained placement
- Checkpoint + migration workflow hooks
- Host reputation scoring and placement weighting
- HTTP API server for control-plane endpoints
- Passing lint/typecheck/test verification gate

## Notes
- Implementation is local-first (`.hivevm/hivevm.db`) and can be split into networked services later.
- Billing is per-second usage materialized into per-minute line items.
- Docker checkpoint support is best-effort; fallback restore starts fresh runtime with checkpoint metadata continuity.

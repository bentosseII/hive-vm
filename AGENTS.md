# HiveVM Agent Notes

## Purpose
HiveVM is a Bun+TypeScript CLI + control plane for agent-native CPU/RAM workloads.

## Runtime
- Bun >= 1.3
- TypeScript strict mode
- SQLite via `bun:sqlite`
- Docker runtime for v1 isolation

## Commands
- `bun install`
- `bun run dev -- --help`
- `bun run verify`
- `bun run test`

## Core Surfaces
- CLI: `hive` / `hived`
- Host daemon: assignment polling, runtime lifecycle, metering ticks
- Scheduler: price/reliability/resource aware placement
- Billing: per-second metering, per-minute line items, host payouts
- Pools: private compute pool membership + placement filters
- Checkpoint/restore: workload migration metadata + runtime hooks
- API server: control-plane HTTP endpoints

## Defaults
- Local state root: `.hivevm/`
- SQLite DB: `.hivevm/hivevm.db`
- Platform take rate: 25%
- Metering line items rounded to minute boundaries

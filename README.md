# HiveVM

Airbnb for agent compute.

HiveVM is an agent-native compute marketplace: CLI + control plane to schedule, meter, and bill
CPU/RAM workloads across hosts.

## Quick Start

```bash
bun install
bun run build
npm link
```

Register as a host:

```bash
hive host init --id host-1 --region us-east --tier prosumer
hive host set --id host-1 --cpu 8 --memory 24gb --storage 500gb --min-price 0.018
hived host daemon --id host-1 --runtime docker --interval 15
```

Submit a workload:

```bash
hive spawn --cpu 2 --memory 4gb --tools github,browser --region us-east --customer local
hive ls
hive logs <workload_id>
```

## Architecture

- Scheduler: price + reliability + resource aware placement.
- Metering: per-second runtime usage ticks.
- Billing: per-minute line items and host payout split.
- Pools: private compute pools and pool-constrained placement.

Core runtime defaults:
- Local state root: `.hivevm/`
- SQLite DB: `.hivevm/hivevm.db`
- Platform take rate: `25%`

## CLI Reference

```bash
# General
hive --help
hive --version
hived --version

# Host lifecycle
hive host init --help
hive host set --help
hive host start --help
hive host stop --help
hive host daemon --help
hive host ls --help
hive host score --help
hive host earnings --help

# Workloads
hive spawn --help
hive ls --help
hive logs <workload_id>
hive sleep <workload_id>
hive wake <workload_id> --on webhook
hive checkpoint <workload_id>
hive migrate <workload_id> --to-host <host_id>

# Pools
hive pool create <name>
hive pool add-host <pool> <host_id>
hive pool ls

# Billing
hive bill usage --from 2026-02-01 --to 2026-02-28
hive bill settle

# API
hive api start --port 8787 --runtime docker
```

## Dev + Verify

```bash
bun run dev -- --help
bun run verify
```

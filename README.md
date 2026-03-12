# Hive

Airbnb for agent compute.

Hive-VM is an agent-native compute marketplace: CLI + control plane to schedule, meter, and bill CPU/RAM workloads across hosts. Hosts list spare compute. Agents rent it. Settlement happens in USDC on Solana and Base via x402.

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
- Settlement: USDC payouts on Solana and Base via x402 protocol.

Core runtime defaults:
- Local state root: `.hivevm/`
- SQLite DB: `.hivevm/hivevm.db`
- Platform take rate: `25%`

## x402 Settlement

Hosts get paid in USDC. When a billing cycle closes, HiveVM settles the metered usage on-chain using the [x402 protocol](https://x402.org) — the HTTP 402 Payment Required standard for machine-to-machine payments.

```
Workload completes → Metering finalizes CPU/RAM bill
    → Settlement constructs USDC transfer on host's chain
    → x402 facilitator verifies + settles on-chain
    → Host wallet receives USDC
```

### Chain Simulator

Validate the full settlement pipeline before going live:

```bash
# Run full simulation (health check, metering, settlement, mint, stress test)
HELIUS_API_KEY=<key> bun run bin/hive-sim-chains.ts --mode full

# Simulate 20 hosts with 50 workloads each
bun run bin/hive-sim-chains.ts --hosts 20 --workloads 50 --chain all

# Stress test Base settlement with 10% failure injection
bun run bin/hive-sim-chains.ts --mode stress --chain base --failure-rate 0.1

# Options
--chain <solana|base|all>                Target chain (default: all)
--mode <settle|meter|mint|stress|full>   Simulation mode (default: full)
--hosts <n>                              Simulated host count (default: 5)
--workloads <n>                          Workloads per host (default: 10)
--failure-rate <0-1>                     Inject failures (default: 0)
--verbose, -v                            Detailed output
```

The simulator generates realistic hosts across regions, creates workloads with actual CPU/RAM utilization patterns, meters them through the pricing engine, and simulates USDC settlement on both Solana (SPL transfer via Helius) and Base (ERC-20 transfer with EIP-1559 fee estimation). It also benchmarks RPC throughput and latency percentiles (p50/p95/p99) under concurrent load.

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

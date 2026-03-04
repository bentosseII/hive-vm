# HiveVM Product Specification

## Overview

**HiveVM** is a two-sided marketplace for agent-native compute.

- **Supply side:** individuals and small operators rent out spare CPU/RAM machines (Mac minis, NUCs, home servers, old PCs, colo boxes) via a lightweight host daemon.
- **Demand side:** agent developers spawn low-cost, pre-tooled sandboxes through a simple CLI/API with per-second billing.

Positioning: **"sfcompute for agent workloads"** (simple market-based compute) combined with **Airbnb-style supply aggregation** (distributed hosts), optimized for CPU/RAM-heavy autonomous agents rather than GPU model training.

Core outcomes:
1. Sub-minute, low-cost execution environments for agents.
2. New recurring revenue stream for idle hardware owners.
3. A market where price and availability are discovered dynamically.

---

## Problem

Agent builders today face three structural issues:

1. **Cloud is overbuilt for agent loops**
   - Most agent workloads are bursty, I/O-heavy, and light-to-moderate CPU.
   - Buying always-on cloud VMs is expensive relative to actual duty cycle.

2. **Operational friction**
   - Bootstrapping secure runtimes with browser automation, git, language runtimes, and tool connectors is repetitive.
   - Recovery/resume for long-lived agent memory is painful.

3. **Idle compute is stranded**
   - Massive underutilized consumer/prosumer hardware exists globally.
   - No reliable, agent-safe market for monetizing this spare capacity.

Result: developers either overpay, self-host unreliably, or constrain product scope.

---

## Solution

HiveVM provides:

- **A host network** that contributes spare compute through a verified daemon.
- **A scheduler + control plane** that places and manages isolated agent sandboxes.
- **Agent-native runtime images** with standard tools preinstalled.
- **Persistent session state** with hibernate/wake semantics.
- **Usage-based billing** with spot and reserved capacity.

### Core user experience

```bash
hive spawn --memory 4gb --cpu 2 --tools github,browser,mcp --persist 7d --region eu-west
```

Expected UX:
- VM ready in <60s.
- Durable state and filesystem across restarts.
- Auto-hibernate when idle; wake on webhook/cron/API.
- Granular billing to the second.

---

## Supply Side (Hosts)

### 1) Host onboarding and daemon

Hosts install a daemon (`hived`) that:
- Detects and advertises allocatable resources:
  - vCPU threads
  - RAM
  - local storage
  - egress bandwidth and latency profile
  - architecture (x86_64/arm64), virtualization capability
- Enforces host-defined limits (max CPU%, RAM cap, quiet hours, power mode).
- Receives signed workload assignments from control plane.
- Streams health, usage, and attestation telemetry.

Example:
```bash
hive host init
hive host set --cpu 8 --memory 24gb --storage 500gb --min-price 0.018
hive host start
```

### 2) Isolation model and trust boundary

Default execution target: **Firecracker microVMs** (Fly.io-inspired model: minimal VMM, jailed process, strong kernel boundary). Fallback on unsupported hardware: hardened rootless containers with reduced trust tier.

#### Security architecture (defense in depth)

1. **Placement trust policy**
   - Sensitive workloads can require "microVM-only" hosts.
   - Lower-trust workloads may use hardened containers on verified hosts.

2. **Runtime isolation**
   - MicroVM per tenant workload.
   - Read-only base image + writable ephemeral overlay.
   - Optional encrypted persistent volume attached per agent.

3. **Kernel and syscall controls**
   - seccomp/AppArmor profiles.
   - Disable nested virtualization, privileged containers, device passthrough by default.
   - No host socket mounts.

4. **Network isolation**
   - Per-VM virtual network namespace.
   - Default-deny east-west traffic.
   - Policy-based egress allowlists.
   - Anti-abuse egress throttling and reputation filters.

5. **Secret handling**
   - Short-lived workload tokens.
   - Envelope-encrypted env vars/secrets; decrypted only inside runtime.
   - Optional customer-managed keys for enterprise tier.

6. **Integrity + attestation**
   - Signed base images.
   - Daemon/device identity certs.
   - Measured boot + host posture checks (where available).

7. **Blast-radius controls**
   - Per-host concurrency caps.
   - Auto-drain on suspicious behavior.
   - Fast revoke/ban and forensic logging.

#### Security tiers

- **Tier A (Datacenter):** Firecracker required, stable network/power SLA, highest trust.
- **Tier B (Prosumer):** Firecracker preferred, strong telemetry, moderate SLA.
- **Tier C (Consumer):** hardened container fallback allowed, lowest trust and pricing.

### 3) Host pricing and payout

Hosts choose:
- **Minimum acceptable rate** (e.g., $0.015/hr equivalent)
- Or **market-rate mode** (accept clearing price)

Payout model:
- Metered per second, settled per minute.
- Host receives gross usage revenue minus platform take (20–30%).
- Weekly payout with reserve buffer for fraud/chargebacks.

### 4) Reputation system

Each host has a composite reputation score:

`HostScore = 35% Uptime + 25% Completion Reliability + 20% Perf Benchmark + 10% Network Quality + 10% Policy Compliance`

Metrics include:
- 7/30-day uptime
- interruption rate
- boot latency percentile
- CPU/RAM benchmark normalized by hardware tier
- packet loss/jitter/egress success
- abuse/security incident history

Higher score improves:
- placement frequency
- reserve-market eligibility
- max billable rates

---

## Demand Side (Agent Builders)

### 1) CLI-first workflow

Primary interface is a simple CLI + API.

```bash
# spawn
hive spawn --memory 4gb --cpu 2 --tools github,browser --persist 7d --region us-east

# list and inspect
hive ls
hive logs vm_123
hive ssh vm_123

# hibernate/wake
hive sleep vm_123
hive wake vm_123 --on webhook
```

### 2) Agent-native runtime images

Default image includes:
- Git, Node.js, Python, package managers
- headless browser tooling
- common SDKs and CLIs
- optional MCP runtime connectors

Profiles:
- `base-agent`
- `browser-agent`
- `data-agent`
- custom image support via OCI-compatible build pipeline

### 3) Persistence and resume semantics

Persistence options:
- `ephemeral` (destroy on stop)
- `persist-7d`, `persist-30d`, custom retention

State model:
- Persistent volume for filesystem state
- Checkpoint metadata for process/session resume
- Optional memory snapshot for warm wake (tier-dependent)

Recovery:
- If host disappears, scheduler rehydrates VM from last durable checkpoint on another host.
- RPO target: <60s for metadata/events; storage based on replication class.

### 4) Lifecycle automation

- **Spin-up target:** P50 <20s warm, P95 <60s cold.
- **Idle policy:** auto-hibernate after configurable idle window.
- **Wake triggers:** webhook, cron, queue event, API.

### 5) Billing model

- Per-second metering, billed per minute line item.
- No commitments for spot.
- Optional reserved contracts (hour/day/week blocks).
- Clear split of compute, storage, bandwidth, and premium tooling fees.

### 6) Multi-region placement

Users can request:
- strict region (e.g., `eu-west`)
- latency max target
- jurisdiction/compliance filters

Scheduler balances latency, price, trust tier, and host reliability.

---

## Economics (Detailed Cost Breakdown)

## 1) Unit economics per VM-hour

Assumptions for consumer-sourced supply:
- Host electricity + wear: **~$0.01/hr** effective baseline for small always-on nodes (varies by geography/hardware utilization).
- Marketplace sell price: **$0.02–$0.05/hr** depending on demand/tier.
- Platform take rate: **20–30%**.

### Example at $0.03/hr sell price, 25% platform cut

- Customer pays: $0.0300/hr
- Platform gross take: $0.0075/hr
- Host payout before host-local costs: $0.0225/hr
- Host net after $0.0100/hr local cost: $0.0125/hr

Platform net must cover:
- control plane compute
- secure networking/relay
- metering + billing infra
- support/fraud/risk reserves

If platform overhead is $0.0025/hr equivalent at scale:
- Platform contribution margin: $0.0075 - $0.0025 = **$0.0050/hr**
- Contribution margin % of revenue: **16.7%**

## 2) Competitive price position

Reference points (illustrative):
- AWS EC2 small footprints: **$0.10+/hr**
- Fly.io footprint range: **$0.005–$0.02/hr** (depends on size/usage model)
- Hetzner amortized low-end VPS equivalents: **~$0.006/hr**

HiveVM target lane:
- **Consumer/spot:** $0.02–$0.03/hr (cheap, variable reliability)
- **Prosumer/reserved:** $0.03–$0.05/hr (better uptime/perf guarantees)

Positioning:
- Cheaper than mainstream cloud for bursty agents.
- Slight premium over ultra-cheap dedicated VPS in exchange for instant, agent-native, per-second, no-commit elasticity.

## 3) Overselling model (bursty demand)

Agent workloads are rarely 100% active. Oversubscription can materially improve returns.

Example host: 16GB RAM machine.
- Physical safe allocatable: 14GB (reserve 2GB host overhead).
- Nominal VM flavor: 2GB each.
- Naive capacity: 7 VMs.
- With burst profile where only ~45% are active at once, scheduler can place 10–12 warm-hibernating VMs with strict memory pressure controls.

Risk controls:
- hard cgroup limits + OOM priority
- no-overcommit for reserved workloads
- dynamic admission control based on recent active set

Economic effect:
- improves billable occupancy without linear hardware growth
- increases host earnings and marketplace liquidity
- must be bounded to protect reliability score

## 4) Scale scenario (10,000 hosts)

Given:
- 10,000 hosts
- average contributed allocatable capacity: 8 vCPU-equivalent-hours per wall-clock hour (normalized)
- utilization: 30%
- average realized bill rate: $0.03/hr

Billable VM-hours per hour:
`10,000 × 8 × 0.30 = 24,000 VM-hours/hour`

Revenue per hour:
`24,000 × $0.03 = $720/hour`

Revenue per month (~730h):
`$720 × 730 = $525,600/month`

Revenue per year:
`$525,600 × 12 = $6,307,200/year`

At 25% take rate:
- Platform gross take: **$1.58M/year**
- Host payouts: **$4.73M/year** (before host local costs)

Upside levers:
- increase utilization from 30% → 45%
- shift mix toward higher-trust reserved workloads ($0.04–$0.05/hr)
- attach higher-margin services (managed storage, browser, MCP hosting)

---

## Marketplace Mechanics

### 1) Spot pricing

Dynamic clearing based on real-time supply/demand by region + trust tier + hardware class.

Inputs:
- available host capacity
- queue depth / pending demand
- reliability-weighted capacity (discount low-score hosts)
- time-of-day seasonality

Outcome:
- Busy periods increase price.
- Idle periods reduce price to stimulate demand.

### 2) Reserved capacity

Customers can reserve guaranteed capacity:
- fixed hourly price for term (day/week/month)
- SLA-backed on eligible tiers
- optional pre-warmed pools for instant wake

Good for production agents requiring predictable latency/uptime.

### 3) Hardware tiers

1. **Consumer**
   - home/office spare machines
   - lowest price, variable reliability
2. **Prosumer**
   - small rack deployments, better networking/power
   - mid price, better consistency
3. **Datacenter**
   - colo/pro providers
   - highest trust/SLA and reserved availability

Scheduler policy allows mixing tiers per workload criticality.

### 4) Matching and placement

Placement objective function balances:
- required resources
- region and latency target
- security tier requirement
- price ceiling
- host score and current load

Supports "best effort cheapest" and "strict SLA" placement modes.

---

## Adjacent Opportunities

### 1) Memory/Storage Marketplace

Offer distributed persistent storage for agent state, embeddings, and vector indexes.

Model:
- hosts lease spare SSD/NVMe as encrypted shards
- customers pay per GB-month + read/write/egress
- replication classes (2x/3x) by durability requirement

Why it works:
- many agents need cheap durable memory more than constant CPU
- complements compute marketplace with sticky recurring revenue

### 2) Tool Hosting Marketplace (MCP-as-a-market)

Hosts run MCP servers/tool endpoints and earn per invocation.

Model:
- verified tool bundles (scrapers, connectors, transforms)
- pay-per-call or reserved TPS plans
- reputation for latency, success rate, safety compliance

Why it works:
- agent developers prefer consuming tools over operating infra
- creates app-store-like ecosystem effects around HiveVM

### 3) Browser Session Marketplace

Provide scalable headless browser capacity for web agents.

Model:
- metered browser-minutes + bandwidth
- anti-bot fingerprint tiers and geo routing
- session persistence and replay artifacts

Why it works:
- browser automation is one of the most common and spiky agent workloads
- can command premium relative to baseline CPU due to complexity

---

## Milestones (Week 1 → Year 1)

### Week 1–2 (Foundations)
- Build CLI skeleton, host daemon MVP, control plane auth.
- Single-region scheduling for ephemeral VMs.
- Internal alpha: 20 hosts, 200 VM runs.
- Target metrics:
  - spawn success >85%
  - P95 spin-up <90s

### Week 3–4 (Private Alpha)
- Add billing/metering pipeline (per-second).
- Add host score v1 (uptime + completion rate).
- Firecracker-first path on supported Linux hosts.
- Targets:
  - 100 hosts onboarded
  - 2,000 VM runs
  - uptime 97%

### Month 2–3 (Beta)
- Persistence volumes + checkpoint restore.
- Spot pricing engine v1.
- Region expansion (2–3 regions).
- Targets:
  - 500 hosts
  - 50 paying demand-side users
  - 25,000 VM-hours/month
  - monthly GMV $500–1,500

### Month 4–6 (Public Launch)
- Reserved capacity contracts.
- Hardware tiering + trust policy controls.
- Security hardening + incident response playbooks.
- Targets:
  - 2,000 hosts
  - 300 paying users/teams
  - 99.0% platform uptime
  - monthly GMV $20k+

### Month 7–9 (Scale)
- Multi-region intelligent routing.
- Host fraud/risk detection.
- Browser/session premium product.
- Targets:
  - 5,000 hosts
  - 1,000 paying users
  - monthly GMV $100k+

### Month 10–12 (Year 1)
- Storage marketplace beta.
- Enterprise controls (audit logs, key mgmt, compliance profiles).
- Mature SLA tiers and reserve marketplace.
- Targets:
  - 10,000 hosts
  - 3,000 paying users
  - 30%+ average utilization
  - annualized GMV run-rate $6M+
  - platform take-rate revenue run-rate $1.2M–$1.8M (20–30% take)

---

## Risks

### 1) Security risk: untrusted code on consumer hardware

Risks:
- sandbox escape
- lateral movement attempts
- host compromise or data leakage

Mitigations:
- microVM-first isolation and strict trust tiers
- signed workloads/images + attestation
- default-deny networking and secret isolation
- continuous vuln scanning, bounty program, kill switches

### 2) Reliability risk: hosts churn/offline

Risks:
- interrupted sessions
- inconsistent availability in some regions

Mitigations:
- replication of persistent state
- rapid failover and rehydration
- host score-based placement bias
- reserve pool for critical workloads

### 3) Network quality variance

Risks:
- high latency/jitter from residential links
- poor egress reliability for web tasks

Mitigations:
- network benchmarking + score penalties
- route-sensitive workloads to prosumer/datacenter tiers
- admission policies for min bandwidth/latency

### 4) Legal and regulatory exposure

Risks:
- data residency compliance
- export control/sanctions
- potential misuse workloads

Mitigations:
- jurisdiction-aware scheduling
- KYC/KYB for high-volume hosts/customers
- abuse detection, reporting, and policy enforcement
- region-specific terms and blocked-use categories

### 5) Competitive pressure from incumbents

Risks:
- cloud vendors reduce prices
- existing platforms add agent-native features

Mitigations:
- win on UX + instant agent tooling + marketplace breadth
- maintain lowest-friction CLI and portability
- grow ecosystem moat (tools, storage, browser products)

---

## Appendix: Example CLI Surface

```bash
# Host operations
hive host init
hive host set --cpu 12 --memory 32gb --storage 1tb --min-price 0.02 --tier prosumer
hive host earnings --last 30d

# Demand-side operations
hive spawn --cpu 2 --memory 4gb --tools github,browser,mcp --persist 7d --region eu-west
hive reserve create --cpu 100 --memory 200gb --region us-east --term 30d
hive wake vm_8f3 --trigger webhook
hive bill usage --from 2026-02-01 --to 2026-02-29
```

This CLI should remain opinionated, minimal, and composable—matching the product promise of instant, low-lock-in agent compute.

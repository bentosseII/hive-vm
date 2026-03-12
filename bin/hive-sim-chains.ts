#!/usr/bin/env bun
/**
 * hive-sim-chains.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * HiveVM — Chain Settlement Simulator
 *
 * Airbnb for agent compute. Simulate the on-chain settlement layer that
 * meters, bills, and settles CPU/RAM workloads across hosts on Solana & Base.
 *
 * This script validates the full billing pipeline:
 *   1. Host registration & wallet health
 *   2. Workload metering → cost calculation
 *   3. USDC settlement simulation via x402
 *   4. Token mint for HiveVM compute credits
 *   5. Multi-host stress testing & throughput benchmarking
 *
 * Usage:
 *   HELIUS_API_KEY=<key> bun run bin/hive-sim-chains.ts [options]
 *
 * Options:
 *   --chain <solana|base|all>        Target chain (default: all)
 *   --mode <settle|meter|mint|stress|full>  Simulation mode (default: full)
 *   --hosts <n>                      Simulated host count (default: 5)
 *   --workloads <n>                  Workloads per host (default: 10)
 *   --failure-rate <0-1>             Injected failure probability (default: 0)
 *   --verbose, -v                    Detailed output
 *
 * Environment:
 *   HELIUS_API_KEY            — Solana Helius RPC key
 *   BASE_RPC_URL              — Override Base RPC (default: https://mainnet.base.org)
 *   HIVE_FAILURE_RATE         — Injected failure rate (default: 0)
 *   HIVE_COST_PER_CPU_SEC     — USD per CPU-second (default: 0.000012)
 *   HIVE_COST_PER_MB_SEC      — USD per MB-second (default: 0.000004)
 * ──────────────────────────────────────────────────────────────────────────────
 */

import * as crypto from "crypto";

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const HIVE_WALLETS = {
  solana: {
    address: "GKXCmL12DQM8yKGfcG9FKMhcqHNq8rCAgHimUbqCzbn",
    chain: "solana" as const,
    network: "mainnet",
    caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    explorer: "https://explorer.solana.com/address/GKXCmL12DQM8yKGfcG9FKMhcqHNq8rCAgHimUbqCzbn",
  },
  base: {
    address: "0xB6762f3dD802B4C0E5ae919b6C10288Be98D61F2",
    chain: "base" as const,
    network: "mainnet",
    caip2: "eip155:8453",
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    explorer: "https://basescan.org/address/0xB6762f3dD802B4C0E5ae919b6C10288Be98D61F2",
  },
} as const;

// Compute pricing model
const PRICING = {
  costPerCpuSec: parseFloat(process.env.HIVE_COST_PER_CPU_SEC || "0.000012"),  // USD
  costPerMbSec: parseFloat(process.env.HIVE_COST_PER_MB_SEC || "0.000004"),    // USD
  minSettlement: 0.001,   // Minimum USDC settlement ($0.001)
  maxSettlement: 100.0,   // Maximum single settlement ($100)
  platformFee: 0.025,     // 2.5% platform cut
};

// ─── RPC ─────────────────────────────────────────────────────────────────────

function getSolanaRpcUrl(): string {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    console.warn("[WARN] HELIUS_API_KEY not set — falling back to public RPC (rate-limited)");
    return "https://api.mainnet-beta.solana.com";
  }
  return `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
}

function getBaseRpcUrl(): string {
  return process.env.BASE_RPC_URL || "https://mainnet.base.org";
}

// ─── Simulation Config ──────────────────────────────────────────────────────

interface SimConfig {
  chain: "solana" | "base" | "all";
  mode: "settle" | "meter" | "mint" | "stress" | "full";
  hosts: number;
  workloads: number;
  failureRate: number;
  verbose: boolean;
}

function parseArgs(): SimConfig {
  const args = process.argv.slice(2);
  const config: SimConfig = {
    chain: "all",
    mode: "full",
    hosts: 5,
    workloads: 10,
    failureRate: parseFloat(process.env.HIVE_FAILURE_RATE || "0"),
    verbose: args.includes("--verbose") || args.includes("-v"),
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--chain" && next) { config.chain = next as SimConfig["chain"]; i++; }
    if (arg === "--mode" && next) { config.mode = next as SimConfig["mode"]; i++; }
    if (arg === "--hosts" && next) { config.hosts = parseInt(next, 10); i++; }
    if (arg === "--workloads" && next) { config.workloads = parseInt(next, 10); i++; }
    if (arg === "--failure-rate" && next) { config.failureRate = parseFloat(next); i++; }
  }

  return config;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface HiveHost {
  id: string;
  name: string;
  chain: "solana" | "base";
  wallet: string;
  cpuCores: number;
  ramMb: number;
  region: string;
  status: "online" | "offline" | "draining";
}

interface Workload {
  id: string;
  hostId: string;
  agentId: string;
  cpuSeconds: number;
  ramMbSeconds: number;
  durationSec: number;
  startedAt: number;
  endedAt: number;
}

interface MeteringResult {
  workloadId: string;
  hostId: string;
  cpuCost: number;
  ramCost: number;
  subtotal: number;
  platformFee: number;
  totalUsdc: number;
}

interface SettlementResult {
  chain: string;
  operation: string;
  success: boolean;
  latencyMs: number;
  costEstimate: string;
  txSignature?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

interface StressReport {
  chain: string;
  totalTx: number;
  successCount: number;
  failCount: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  maxLatencyMs: number;
  minLatencyMs: number;
  throughputTps: number;
  totalSettledUsdc: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOGGING
// ═══════════════════════════════════════════════════════════════════════════════

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", magenta: "\x1b[35m", cyan: "\x1b[36m",
  orange: "\x1b[38;5;208m", lime: "\x1b[38;5;154m",
};

function log(level: "info" | "warn" | "error" | "ok" | "debug" | "meter" | "settle", msg: string, data?: unknown): void {
  const colors: Record<string, string> = {
    info: C.blue, warn: C.yellow, error: C.red, ok: C.green,
    debug: C.dim, meter: C.orange, settle: C.lime,
  };
  const icons: Record<string, string> = {
    info: "│", warn: "▲", error: "✗", ok: "✓",
    debug: "·", meter: "◈", settle: "◆",
  };
  const prefix = `${colors[level]}${icons[level]} ${level.toUpperCase().padEnd(6)}${C.reset}`;
  console.log(`  ${prefix} ${msg}`);
  if (data) console.log(`  ${C.dim}${JSON.stringify(data, null, 2)}${C.reset}`);
}

function banner(): void {
  console.log(`
${C.cyan}╔══════════════════════════════════════════════════════════════╗${C.reset}
${C.cyan}║${C.reset}  ${C.bold}⬡ HiveVM${C.reset} — Chain Settlement Simulator                     ${C.cyan}║${C.reset}
${C.cyan}║${C.reset}  ${C.dim}Airbnb for agent compute · Solana + Base${C.reset}                   ${C.cyan}║${C.reset}
${C.cyan}╚══════════════════════════════════════════════════════════════╝${C.reset}
`);
}

function section(text: string): void {
  console.log(`\n${C.cyan}  ── ${text} ${"─".repeat(Math.max(0, 52 - text.length))}${C.reset}\n`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// JSON-RPC
// ═══════════════════════════════════════════════════════════════════════════════

let rpcId = 0;

async function rpc<T = unknown>(url: string, method: string, params: unknown[], timeoutMs = 30000): Promise<T> {
  const id = ++rpcId;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const json = (await res.json()) as { result?: T; error?: { code: number; message: string } };
    if (json.error) throw new Error(`RPC ${json.error.code}: ${json.error.message}`);
    return json.result as T;
  } finally {
    clearTimeout(timer);
  }
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, durationMs: Math.round(performance.now() - start) };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

// ═══════════════════════════════════════════════════════════════════════════════
// FAILURE INJECTION
// ═══════════════════════════════════════════════════════════════════════════════

type FailureType = "timeout" | "revert" | "insufficient_funds" | "nonce_mismatch" | "host_offline" | "metering_overflow";

function maybeInjectFailure(rate: number): void {
  if (Math.random() >= rate) return;
  const failures: FailureType[] = ["timeout", "revert", "insufficient_funds", "nonce_mismatch", "host_offline", "metering_overflow"];
  const f = failures[Math.floor(Math.random() * failures.length)];
  const msgs: Record<FailureType, string> = {
    timeout: "[INJECTED] Settlement timed out after 30000ms",
    revert: "[INJECTED] Settlement transaction reverted on-chain",
    insufficient_funds: "[INJECTED] Insufficient USDC for settlement",
    nonce_mismatch: "[INJECTED] Nonce too low — concurrent settlement detected",
    host_offline: "[INJECTED] Host went offline during billing cycle",
    metering_overflow: "[INJECTED] Metering counter overflow — workload exceeded u64 max",
  };
  log("warn", `Failure injection: ${f}`);
  throw new Error(msgs[f]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// HOST & WORKLOAD GENERATORS
// ═══════════════════════════════════════════════════════════════════════════════

const REGIONS = ["us-east-1", "us-west-2", "eu-west-1", "ap-southeast-1", "sa-east-1"];
const AGENT_PREFIXES = ["claude", "gpt", "gemini", "llama", "mixtral", "arb-bot", "indexer", "scraper"];

function rid(): string { return crypto.randomBytes(4).toString("hex"); }

function generateHosts(count: number): HiveHost[] {
  return Array.from({ length: count }, (_, i) => {
    const chain = i % 2 === 0 ? "solana" : "base";
    const wallet = chain === "solana" ? HIVE_WALLETS.solana.address : HIVE_WALLETS.base.address;
    return {
      id: `host-${rid()}`,
      name: `hive-${REGIONS[i % REGIONS.length].split("-")[0]}-${i.toString().padStart(2, "0")}`,
      chain,
      wallet,
      cpuCores: [2, 4, 8, 16, 32][Math.floor(Math.random() * 5)],
      ramMb: [4096, 8192, 16384, 32768, 65536][Math.floor(Math.random() * 5)],
      region: REGIONS[i % REGIONS.length],
      status: "online" as const,
    };
  });
}

function generateWorkloads(host: HiveHost, count: number): Workload[] {
  return Array.from({ length: count }, () => {
    const durationSec = Math.round(Math.random() * 3600 + 60); // 1min - 1hr
    const cpuUtil = Math.random() * 0.8 + 0.1; // 10-90% utilization
    const ramUtil = Math.random() * 0.7 + 0.15;
    const cpuSeconds = durationSec * host.cpuCores * cpuUtil;
    const ramMbSeconds = durationSec * host.ramMb * ramUtil;
    const now = Date.now();

    return {
      id: `wl-${rid()}`,
      hostId: host.id,
      agentId: `${AGENT_PREFIXES[Math.floor(Math.random() * AGENT_PREFIXES.length)]}-${rid()}`,
      cpuSeconds: Math.round(cpuSeconds * 100) / 100,
      ramMbSeconds: Math.round(ramMbSeconds * 100) / 100,
      durationSec,
      startedAt: now - durationSec * 1000,
      endedAt: now,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// METERING ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function meterWorkload(workload: Workload): MeteringResult {
  const cpuCost = workload.cpuSeconds * PRICING.costPerCpuSec;
  const ramCost = workload.ramMbSeconds * PRICING.costPerMbSec;
  const subtotal = cpuCost + ramCost;
  const platformFee = subtotal * PRICING.platformFee;
  const totalUsdc = Math.max(PRICING.minSettlement, Math.min(PRICING.maxSettlement, subtotal + platformFee));

  return {
    workloadId: workload.id,
    hostId: workload.hostId,
    cpuCost: Math.round(cpuCost * 1e6) / 1e6,
    ramCost: Math.round(ramCost * 1e6) / 1e6,
    subtotal: Math.round(subtotal * 1e6) / 1e6,
    platformFee: Math.round(platformFee * 1e6) / 1e6,
    totalUsdc: Math.round(totalUsdc * 1e6) / 1e6,
  };
}

function aggregateHostBill(meters: MeteringResult[]): {
  totalCpu: number;
  totalRam: number;
  subtotal: number;
  fees: number;
  grandTotal: number;
  workloadCount: number;
} {
  const totalCpu = meters.reduce((s, m) => s + m.cpuCost, 0);
  const totalRam = meters.reduce((s, m) => s + m.ramCost, 0);
  const subtotal = meters.reduce((s, m) => s + m.subtotal, 0);
  const fees = meters.reduce((s, m) => s + m.platformFee, 0);
  const grandTotal = meters.reduce((s, m) => s + m.totalUsdc, 0);
  return {
    totalCpu: Math.round(totalCpu * 1e6) / 1e6,
    totalRam: Math.round(totalRam * 1e6) / 1e6,
    subtotal: Math.round(subtotal * 1e6) / 1e6,
    fees: Math.round(fees * 1e6) / 1e6,
    grandTotal: Math.round(grandTotal * 1e6) / 1e6,
    workloadCount: meters.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SOLANA SETTLEMENT
// ═══════════════════════════════════════════════════════════════════════════════

class SolanaSettlement {
  private rpcUrl = getSolanaRpcUrl();
  private wallet = HIVE_WALLETS.solana;

  async healthCheck(): Promise<SettlementResult> {
    const op = "solana:host-wallet-health";
    try {
      const { result, durationMs } = await timed(async () => {
        const [balance, slot, blockHash, version] = await Promise.all([
          rpc<{ value: number }>(this.rpcUrl, "getBalance", [this.wallet.address]),
          rpc<number>(this.rpcUrl, "getSlot", []),
          rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>(
            this.rpcUrl, "getLatestBlockhash", [{ commitment: "finalized" }]
          ),
          rpc<{ "solana-core": string }>(this.rpcUrl, "getVersion", []),
        ]);
        return { balance, slot, blockHash, version };
      });

      const balanceSol = result.balance.value / 1e9;

      // Check USDC token account
      let usdcBalance = 0;
      try {
        const tokenAccounts = await rpc<{
          value: Array<{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: number }; mint: string } } } } }>;
        }>(this.rpcUrl, "getTokenAccountsByOwner", [
          this.wallet.address,
          { mint: this.wallet.usdcMint },
          { encoding: "jsonParsed" },
        ]);
        for (const ta of tokenAccounts.value) {
          usdcBalance += ta.account.data.parsed.info.tokenAmount.uiAmount;
        }
      } catch { /* no USDC account */ }

      log("ok", `Solana wallet: ${balanceSol.toFixed(4)} SOL / $${usdcBalance.toFixed(2)} USDC`);
      log("info", `Slot: ${result.slot} | Version: ${result.version["solana-core"]}`);

      return {
        chain: "solana", operation: op, success: true, latencyMs: durationMs,
        costEstimate: "0 SOL",
        metadata: { balanceSol, usdcBalance, slot: result.slot, version: result.version["solana-core"] },
      };
    } catch (err: any) {
      log("error", `Solana health check failed: ${err.message}`);
      return { chain: "solana", operation: op, success: false, latencyMs: 0, costEstimate: "0 SOL", error: err.message };
    }
  }

  async simulateSettlement(host: HiveHost, bill: ReturnType<typeof aggregateHostBill>, config: SimConfig): Promise<SettlementResult> {
    const op = "solana:settle-host-bill";
    maybeInjectFailure(config.failureRate);

    try {
      const { result, durationMs } = await timed(async () => {
        // Get rent exemption for a token transfer instruction
        const rentExemption = await rpc<number>(this.rpcUrl, "getMinimumBalanceForRentExemption", [165]);

        // Get recent priority fees
        const fees = await rpc<Array<{ prioritizationFee: number }>>(this.rpcUrl, "getRecentPrioritizationFees", []);
        const avgPriorityFee = fees.length > 0 ? fees.reduce((s, f) => s + f.prioritizationFee, 0) / fees.length : 0;

        // Get latest blockhash for the simulated tx
        const blockHash = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>(
          this.rpcUrl, "getLatestBlockhash", [{ commitment: "finalized" }]
        );

        return { rentExemption, avgPriorityFee, blockHash };
      });

      const baseTxFee = 0.000005; // 5000 lamports
      const priorityFeeSol = result.avgPriorityFee / 1e9;
      const settlementCostSol = baseTxFee + priorityFeeSol;

      // USDC atomic amount (6 decimals)
      const usdcAtomic = Math.round(bill.grandTotal * 1e6);
      const simTxHash = crypto.createHash("sha256")
        .update(`hive-settle-${host.id}-${Date.now()}`)
        .digest("base58" as any || "hex").slice(0, 88);

      log("settle", `Host ${host.name}: $${bill.grandTotal.toFixed(4)} USDC (${bill.workloadCount} workloads)`);
      log("info", `Tx fee: ${settlementCostSol.toFixed(9)} SOL | Priority: ${result.avgPriorityFee.toFixed(0)} µlamports`);

      return {
        chain: "solana", operation: op, success: true, latencyMs: durationMs,
        costEstimate: `${settlementCostSol.toFixed(9)} SOL + $${bill.grandTotal.toFixed(4)} USDC`,
        txSignature: simTxHash,
        metadata: {
          host: host.name, region: host.region,
          workloads: bill.workloadCount,
          usdcSettled: bill.grandTotal, usdcAtomic,
          platformFee: bill.fees, txFeeSol: settlementCostSol,
          blockhash: result.blockHash.value.blockhash,
        },
      };
    } catch (err: any) {
      log("error", `Settlement failed for ${host.name}: ${err.message}`);
      return { chain: "solana", operation: op, success: false, latencyMs: 0, costEstimate: "0 SOL", error: err.message };
    }
  }

  async simulateMint(config: SimConfig): Promise<SettlementResult> {
    const op = "solana:mint-compute-credits";
    maybeInjectFailure(config.failureRate);

    try {
      const { result, durationMs } = await timed(async () => {
        const rentExemption = await rpc<number>(this.rpcUrl, "getMinimumBalanceForRentExemption", [82]);
        const fees = await rpc<Array<{ prioritizationFee: number }>>(this.rpcUrl, "getRecentPrioritizationFees", []);
        const avgFee = fees.length > 0 ? fees.reduce((s, f) => s + f.prioritizationFee, 0) / fees.length : 0;
        const tokenAccounts = await rpc<{ value: unknown[] }>(this.rpcUrl, "getTokenAccountsByOwner", [
          this.wallet.address,
          { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
          { encoding: "jsonParsed" },
        ]);
        return { rentExemption, avgFee, existingTokens: tokenAccounts.value.length };
      });

      const rentSol = result.rentExemption / 1e9;
      const totalCost = rentSol + 0.000005 + result.avgFee / 1e9;
      const mintAddress = crypto.createHash("sha256")
        .update(`hive-credit-mint-${Date.now()}`).digest("hex").slice(0, 44);

      log("ok", `Compute credit mint simulated`);
      log("info", `Mint: ${mintAddress.slice(0, 16)}… | Rent: ${rentSol.toFixed(6)} SOL`);
      log("info", `Existing token accounts: ${result.existingTokens}`);

      return {
        chain: "solana", operation: op, success: true, latencyMs: durationMs,
        costEstimate: `${totalCost.toFixed(9)} SOL`,
        metadata: {
          mintAddress, rentExemptionSol: rentSol,
          avgPriorityFee: result.avgFee, existingTokenAccounts: result.existingTokens,
          tokenDetails: { name: "HiveVM Compute Credit", symbol: "HIVE", decimals: 6, supply: "1000000000" },
        },
      };
    } catch (err: any) {
      log("error", `Mint simulation failed: ${err.message}`);
      return { chain: "solana", operation: op, success: false, latencyMs: 0, costEstimate: "0 SOL", error: err.message };
    }
  }

  async stressTest(config: SimConfig): Promise<StressReport> {
    return runStressTest("solana", this.rpcUrl, this.wallet.address, "getBalance", config);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BASE SETTLEMENT
// ═══════════════════════════════════════════════════════════════════════════════

class BaseSettlement {
  private rpcUrl = getBaseRpcUrl();
  private wallet = HIVE_WALLETS.base;

  async healthCheck(): Promise<SettlementResult> {
    const op = "base:host-wallet-health";
    try {
      const { result, durationMs } = await timed(async () => {
        const [balance, nonce, gasPrice, chainId, blockNumber] = await Promise.all([
          rpc<string>(this.rpcUrl, "eth_getBalance", [this.wallet.address, "latest"]),
          rpc<string>(this.rpcUrl, "eth_getTransactionCount", [this.wallet.address, "latest"]),
          rpc<string>(this.rpcUrl, "eth_gasPrice", []),
          rpc<string>(this.rpcUrl, "eth_chainId", []),
          rpc<string>(this.rpcUrl, "eth_blockNumber", []),
        ]);
        return { balance, nonce, gasPrice, chainId, blockNumber };
      });

      const balanceEth = Number(BigInt(result.balance)) / 1e18;
      const gasPriceGwei = Number(BigInt(result.gasPrice)) / 1e9;

      // Check USDC balance via balanceOf
      let usdcBalance = 0;
      try {
        const data = "0x70a08231" + this.wallet.address.toLowerCase().replace("0x", "").padStart(64, "0");
        const usdcHex = await rpc<string>(this.rpcUrl, "eth_call", [
          { to: this.wallet.usdcAddress, data }, "latest",
        ]);
        usdcBalance = Number(BigInt(usdcHex)) / 1e6;
      } catch { /* no USDC */ }

      log("ok", `Base wallet: ${balanceEth.toFixed(6)} ETH / $${usdcBalance.toFixed(2)} USDC`);
      log("info", `Gas: ${gasPriceGwei.toFixed(4)} Gwei | Block: ${parseInt(result.blockNumber, 16)}`);

      return {
        chain: "base", operation: op, success: true, latencyMs: durationMs,
        costEstimate: "0 ETH",
        metadata: {
          balanceEth, usdcBalance, gasPriceGwei,
          nonce: parseInt(result.nonce, 16),
          chainId: parseInt(result.chainId, 16),
          blockNumber: parseInt(result.blockNumber, 16),
        },
      };
    } catch (err: any) {
      log("error", `Base health check failed: ${err.message}`);
      return { chain: "base", operation: op, success: false, latencyMs: 0, costEstimate: "0 ETH", error: err.message };
    }
  }

  async simulateSettlement(host: HiveHost, bill: ReturnType<typeof aggregateHostBill>, config: SimConfig): Promise<SettlementResult> {
    const op = "base:settle-host-bill";
    maybeInjectFailure(config.failureRate);

    try {
      const { result, durationMs } = await timed(async () => {
        const gasPrice = await rpc<string>(this.rpcUrl, "eth_gasPrice", []);

        // EIP-1559
        let maxFeePerGas: bigint;
        let maxPriorityFeePerGas: bigint;
        try {
          const priorityHex = await rpc<string>(this.rpcUrl, "eth_maxPriorityFeePerGas", []);
          const block = await rpc<{ baseFeePerGas: string }>(this.rpcUrl, "eth_getBlockByNumber", ["latest", false]);
          const baseFee = BigInt(block.baseFeePerGas);
          maxPriorityFeePerGas = BigInt(priorityHex);
          maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;
        } catch {
          maxFeePerGas = BigInt(gasPrice);
          maxPriorityFeePerGas = BigInt(1500000000);
        }

        // ERC-20 transfer gas estimate (~65000 for USDC transfer)
        const gasEstimate = 65000;

        return { gasPrice, maxFeePerGas, maxPriorityFeePerGas, gasEstimate };
      });

      const costWei = BigInt(result.gasEstimate) * result.maxFeePerGas;
      const costEth = Number(costWei) / 1e18;
      const simTxHash = "0x" + crypto.createHash("sha256")
        .update(`hive-settle-${host.id}-${Date.now()}`).digest("hex").slice(0, 64);

      log("settle", `Host ${host.name}: $${bill.grandTotal.toFixed(4)} USDC (${bill.workloadCount} workloads)`);
      log("info", `Gas: ${result.gasEstimate} units @ ${(Number(result.maxFeePerGas) / 1e9).toFixed(4)} Gwei = ${costEth.toFixed(8)} ETH`);

      return {
        chain: "base", operation: op, success: true, latencyMs: durationMs,
        costEstimate: `${costEth.toFixed(8)} ETH + $${bill.grandTotal.toFixed(4)} USDC`,
        txSignature: simTxHash,
        metadata: {
          host: host.name, region: host.region,
          workloads: bill.workloadCount,
          usdcSettled: bill.grandTotal,
          platformFee: bill.fees, gasCostEth: costEth,
          gasUnits: result.gasEstimate,
          maxFeeGwei: Number(result.maxFeePerGas) / 1e9,
        },
      };
    } catch (err: any) {
      log("error", `Settlement failed for ${host.name}: ${err.message}`);
      return { chain: "base", operation: op, success: false, latencyMs: 0, costEstimate: "0 ETH", error: err.message };
    }
  }

  async simulateMint(config: SimConfig): Promise<SettlementResult> {
    const op = "base:mint-compute-credits";
    maybeInjectFailure(config.failureRate);

    try {
      const { result, durationMs } = await timed(async () => {
        const gasPrice = await rpc<string>(this.rpcUrl, "eth_gasPrice", []);
        let gasEstimate: number;
        try {
          // ERC-20 deployment bytecode (simplified for gas estimation)
          const bytecode = "0x60806040523480156100105760006000fd5b50610180806100206000396000f3fe";
          const gasHex = await rpc<string>(this.rpcUrl, "eth_estimateGas", [
            { from: this.wallet.address, data: bytecode },
          ]);
          gasEstimate = parseInt(gasHex, 16);
        } catch {
          gasEstimate = 750000;
          log("warn", "Gas estimation failed — using fallback: 750,000");
        }
        return { gasPrice, gasEstimate };
      });

      const gasPriceGwei = Number(BigInt(result.gasPrice)) / 1e9;
      const costWei = BigInt(result.gasEstimate) * BigInt(result.gasPrice);
      const costEth = Number(costWei) / 1e18;
      const contractAddr = "0x" + crypto.createHash("sha256")
        .update(`hive-credit-${Date.now()}`).digest("hex").slice(0, 40);

      log("ok", `Compute credit ERC-20 mint simulated`);
      log("info", `Contract: ${contractAddr.slice(0, 18)}… | Gas: ${result.gasEstimate.toLocaleString()} @ ${gasPriceGwei.toFixed(4)} Gwei`);

      return {
        chain: "base", operation: op, success: true, latencyMs: durationMs,
        costEstimate: `${costEth.toFixed(8)} ETH`,
        metadata: {
          contractAddress: contractAddr, gasEstimate: result.gasEstimate, gasPriceGwei, costEth,
          tokenDetails: { name: "HiveVM Compute Credit", symbol: "HIVE", decimals: 6, supply: "1000000000" },
        },
      };
    } catch (err: any) {
      log("error", `Mint simulation failed: ${err.message}`);
      return { chain: "base", operation: op, success: false, latencyMs: 0, costEstimate: "0 ETH", error: err.message };
    }
  }

  async stressTest(config: SimConfig): Promise<StressReport> {
    return runStressTest("base", this.rpcUrl, this.wallet.address, "eth_getBalance", config);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED STRESS TEST
// ═══════════════════════════════════════════════════════════════════════════════

async function runStressTest(
  chain: string,
  rpcUrl: string,
  wallet: string,
  method: string,
  config: SimConfig
): Promise<StressReport> {
  section(`${chain.toUpperCase()} Stress Test`);
  const concurrency = config.hosts * 2;
  const iterations = config.workloads;
  log("info", `${iterations} iterations × ${concurrency} concurrent (simulating ${config.hosts} hosts)`);

  const latencies: number[] = [];
  let successCount = 0;
  let failCount = 0;
  let totalSettledUsdc = 0;
  const startTime = performance.now();

  for (let iter = 0; iter < iterations; iter++) {
    const batch = Array.from({ length: concurrency }, async () => {
      try {
        maybeInjectFailure(config.failureRate);
        const params = method === "getBalance" ? [wallet] : [wallet, "latest"];
        const { durationMs } = await timed(async () => { await rpc(rpcUrl, method, params); });
        latencies.push(durationMs);
        successCount++;
        totalSettledUsdc += Math.random() * 0.5; // Simulated settlement amount
      } catch { failCount++; }
    });
    await Promise.all(batch);
    if (config.verbose) log("debug", `Iteration ${iter + 1}/${iterations}`);
  }

  const totalMs = performance.now() - startTime;
  const sorted = latencies.slice().sort((a, b) => a - b);
  const totalTx = successCount + failCount;

  const report: StressReport = {
    chain, totalTx, successCount, failCount,
    avgLatencyMs: sorted.length > 0 ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0,
    p50LatencyMs: percentile(sorted, 50),
    p95LatencyMs: percentile(sorted, 95),
    p99LatencyMs: percentile(sorted, 99),
    maxLatencyMs: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
    minLatencyMs: sorted.length > 0 ? sorted[0] : 0,
    throughputTps: parseFloat((totalTx / (totalMs / 1000)).toFixed(2)),
    totalSettledUsdc: Math.round(totalSettledUsdc * 100) / 100,
  };

  log("ok", `${report.throughputTps} TPS | ${successCount}/${totalTx} success`);
  log("info", `Latency: avg=${report.avgLatencyMs}ms p50=${report.p50LatencyMs}ms p95=${report.p95LatencyMs}ms p99=${report.p99LatencyMs}ms`);
  log("info", `Simulated settlement volume: $${report.totalSettledUsdc.toFixed(2)} USDC`);

  return report;
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTING
// ═══════════════════════════════════════════════════════════════════════════════

function printResults(results: SettlementResult[]): void {
  section("Settlement Results");
  console.log(`  ${C.dim}${"CHAIN".padEnd(8)} ${"OPERATION".padEnd(28)} ${"STATUS".padEnd(8)} ${"LATENCY".padEnd(10)} ${"COST"}${C.reset}`);
  console.log(`  ${"─".repeat(72)}`);

  for (const r of results) {
    const status = r.success ? `${C.green}OK${C.reset}` : `${C.red}FAIL${C.reset}`;
    const lat = r.success ? `${r.latencyMs}ms` : "—";
    console.log(`  ${r.chain.padEnd(8)} ${r.operation.padEnd(28)} ${status.padEnd(16)} ${lat.padEnd(10)} ${r.costEstimate}`);
    if (r.error) console.log(`  ${C.red}  └─ ${r.error}${C.reset}`);
  }
}

function printMeteringSummary(hosts: HiveHost[], bills: Map<string, ReturnType<typeof aggregateHostBill>>): void {
  section("Metering Summary");
  console.log(`  ${C.dim}${"HOST".padEnd(20)} ${"CHAIN".padEnd(8)} ${"REGION".padEnd(16)} ${"WL".padEnd(5)} ${"CPU($)".padEnd(10)} ${"RAM($)".padEnd(10)} ${"TOTAL($)"}${C.reset}`);
  console.log(`  ${"─".repeat(80)}`);

  let grandTotal = 0;
  for (const host of hosts) {
    const bill = bills.get(host.id);
    if (!bill) continue;
    grandTotal += bill.grandTotal;
    const chainColor = host.chain === "solana" ? C.magenta : C.blue;
    console.log(
      `  ${host.name.padEnd(20)} ${chainColor}${host.chain.padEnd(8)}${C.reset} ` +
      `${host.region.padEnd(16)} ${String(bill.workloadCount).padEnd(5)} ` +
      `${bill.totalCpu.toFixed(4).padEnd(10)} ${bill.totalRam.toFixed(4).padEnd(10)} ` +
      `${C.bold}${bill.grandTotal.toFixed(4)}${C.reset}`
    );
  }

  console.log(`  ${"─".repeat(80)}`);
  console.log(`  ${"".padEnd(59)} ${C.bold}$${grandTotal.toFixed(4)} USDC${C.reset}\n`);
}

function printStressReports(reports: StressReport[]): void {
  section("Stress Test Reports");
  for (const r of reports) {
    console.log(`  ${C.bold}${r.chain.toUpperCase()}${C.reset}`);
    console.log(`    Transactions: ${r.totalTx} (${r.successCount} ok / ${r.failCount} fail)`);
    console.log(`    Throughput:   ${r.throughputTps} TPS`);
    console.log(`    Latency:      avg=${r.avgLatencyMs}ms p50=${r.p50LatencyMs} p95=${r.p95LatencyMs} p99=${r.p99LatencyMs}`);
    console.log(`    Settled:      $${r.totalSettledUsdc.toFixed(2)} USDC (simulated)`);
    console.log("");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const config = parseArgs();
  banner();

  log("info", `Chain: ${config.chain} | Mode: ${config.mode} | Hosts: ${config.hosts} | Workloads/host: ${config.workloads}`);
  log("info", `Failure rate: ${(config.failureRate * 100).toFixed(1)}% | Pricing: $${PRICING.costPerCpuSec}/cpu·s $${PRICING.costPerMbSec}/mb·s`);
  console.log(`\n  ${C.dim}Wallets:${C.reset}`);
  console.log(`    Solana: ${HIVE_WALLETS.solana.address}`);
  console.log(`    Base:   ${HIVE_WALLETS.base.address}`);
  console.log(`    RPC:    ${getSolanaRpcUrl().replace(/api-key=.*/, "api-key=***")} | ${getBaseRpcUrl()}\n`);

  const solana = new SolanaSettlement();
  const base = new BaseSettlement();
  const results: SettlementResult[] = [];
  const stressReports: StressReport[] = [];

  const runSol = config.chain === "solana" || config.chain === "all";
  const runBase = config.chain === "base" || config.chain === "all";

  // ─── Health Checks ──────────────────────────────────────────────────

  section("Host Wallet Health");
  if (runSol) results.push(await solana.healthCheck());
  if (runBase) results.push(await base.healthCheck());

  // ─── Metering ───────────────────────────────────────────────────────

  if (config.mode === "meter" || config.mode === "settle" || config.mode === "full") {
    section("Workload Metering");
    const hosts = generateHosts(config.hosts);
    const bills = new Map<string, ReturnType<typeof aggregateHostBill>>();

    for (const host of hosts) {
      const workloads = generateWorkloads(host, config.workloads);
      const meters = workloads.map(meterWorkload);
      const bill = aggregateHostBill(meters);
      bills.set(host.id, bill);

      if (config.verbose) {
        log("meter", `${host.name}: ${bill.workloadCount} workloads → $${bill.grandTotal.toFixed(4)} USDC`);
      }
    }

    printMeteringSummary(hosts, bills);

    // ─── Settlement ─────────────────────────────────────────────────

    if (config.mode === "settle" || config.mode === "full") {
      section("On-Chain Settlement");

      for (const host of hosts) {
        const bill = bills.get(host.id)!;
        if (host.chain === "solana" && runSol) {
          results.push(await solana.simulateSettlement(host, bill, config));
        } else if (host.chain === "base" && runBase) {
          results.push(await base.simulateSettlement(host, bill, config));
        }
      }
    }
  }

  // ─── Mint ───────────────────────────────────────────────────────────

  if (config.mode === "mint" || config.mode === "full") {
    section("Compute Credit Token Mint");
    if (runSol) results.push(await solana.simulateMint(config));
    if (runBase) results.push(await base.simulateMint(config));
  }

  // ─── Stress ─────────────────────────────────────────────────────────

  if (config.mode === "stress" || config.mode === "full") {
    if (runSol) stressReports.push(await solana.stressTest(config));
    if (runBase) stressReports.push(await base.stressTest(config));
  }

  // ─── Summary ────────────────────────────────────────────────────────

  printResults(results);
  if (stressReports.length > 0) printStressReports(stressReports);

  section("Cost Rollup");
  const solCosts = results.filter(r => r.chain === "solana" && r.success).reduce((s, r) => s + parseFloat(r.costEstimate), 0);
  const baseCosts = results.filter(r => r.chain === "base" && r.success).reduce((s, r) => s + parseFloat(r.costEstimate), 0);
  console.log(`  Solana tx fees:   ${solCosts.toFixed(9)} SOL`);
  console.log(`  Base tx fees:     ${baseCosts.toFixed(9)} ETH`);
  console.log(`  ${C.dim}(USDC settlements are on top of network fees)${C.reset}\n`);

  const anyFailed = results.some(r => !r.success);
  if (anyFailed) {
    log("warn", "Some simulations failed — review results above");
    process.exit(1);
  }

  log("ok", "All simulations passed");
  console.log(`\n${C.cyan}  ⬡ HiveVM settlement layer validated${C.reset}\n`);
}

main().catch((err) => {
  log("error", `Fatal: ${err.message}`);
  console.error(err);
  process.exit(2);
});

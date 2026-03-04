import type {
	Assignment,
	BillingLineItem,
	Checkpoint,
	Host,
	HostEarning,
	Pool,
	UsageEvent,
	Workload,
} from '../types/domain'
import { safeJsonParse } from '../utils/json'

const num = (value: unknown, fallback = 0) => (typeof value === 'number' ? value : fallback)
const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)

export const mapHost = (row: Record<string, unknown>): Host => ({
	id: str(row.id),
	name: str(row.name),
	region: str(row.region),
	tier: str(row.tier) as Host['tier'],
	cpuTotal: num(row.cpu_total),
	memoryMbTotal: num(row.memory_mb_total),
	storageGbTotal: num(row.storage_gb_total),
	minPrice: num(row.min_price),
	maxCpuPct: num(row.max_cpu_pct),
	ramCapMb: row.ram_cap_mb === null ? null : num(row.ram_cap_mb),
	quietHours: row.quiet_hours === null ? null : str(row.quiet_hours),
	powerMode: str(row.power_mode),
	daemonStatus: str(row.daemon_status) as Host['daemonStatus'],
	uptime7d: num(row.uptime_7d),
	completionRate: num(row.completion_rate),
	perfScore: num(row.perf_score),
	networkScore: num(row.network_score),
	policyScore: num(row.policy_score),
	score: num(row.score),
	lastHeartbeat: row.last_heartbeat === null ? null : num(row.last_heartbeat),
	createdAt: num(row.created_at),
	updatedAt: num(row.updated_at),
})

export const mapPool = (row: Record<string, unknown>): Pool => ({
	id: str(row.id),
	name: str(row.name),
	isPrivate: num(row.is_private) === 1,
	createdAt: num(row.created_at),
})

export const mapWorkload = (row: Record<string, unknown>): Workload => ({
	id: str(row.id),
	customerId: str(row.customer_id),
	image: str(row.image),
	cpu: num(row.cpu),
	memoryMb: num(row.memory_mb),
	storageGb: num(row.storage_gb),
	tools: safeJsonParse<string[]>(str(row.tools, '[]'), []),
	persistPolicy: str(row.persist_policy),
	region: str(row.region),
	tierRequired: row.tier_required ? (str(row.tier_required) as Workload['tierRequired']) : null,
	poolId: row.pool_id ? str(row.pool_id) : null,
	priceCap: row.price_cap === null ? null : num(row.price_cap),
	status: str(row.status) as Workload['status'],
	hostId: row.host_id ? str(row.host_id) : null,
	runtimeId: row.runtime_id ? str(row.runtime_id) : null,
	assignedRate: row.assigned_rate === null ? null : num(row.assigned_rate),
	wakeTrigger: row.wake_trigger ? str(row.wake_trigger) : null,
	createdAt: num(row.created_at),
	updatedAt: num(row.updated_at),
	startedAt: row.started_at === null ? null : num(row.started_at),
	stoppedAt: row.stopped_at === null ? null : num(row.stopped_at),
	checkpointId: row.checkpoint_id ? str(row.checkpoint_id) : null,
	lastError: row.last_error ? str(row.last_error) : null,
})

export const mapAssignment = (row: Record<string, unknown>): Assignment => ({
	id: num(row.id),
	workloadId: str(row.workload_id),
	hostId: str(row.host_id),
	action: str(row.action) as Assignment['action'],
	payload: safeJsonParse<Record<string, unknown>>(row.payload ? str(row.payload) : null, {}),
	status: str(row.status) as Assignment['status'],
	assignedAt: num(row.assigned_at),
	handledAt: row.handled_at === null ? null : num(row.handled_at),
	reason: row.reason === null ? null : str(row.reason),
})

export const mapUsageEvent = (row: Record<string, unknown>): UsageEvent => ({
	id: num(row.id),
	workloadId: str(row.workload_id),
	hostId: str(row.host_id),
	timestamp: num(row.timestamp),
	seconds: num(row.seconds),
	cpuSeconds: num(row.cpu_seconds),
	memoryMbAvg: num(row.memory_mb_avg),
	egressMb: num(row.egress_mb),
})

export const mapBillingLineItem = (row: Record<string, unknown>): BillingLineItem => ({
	id: num(row.id),
	workloadId: str(row.workload_id),
	hostId: str(row.host_id),
	minuteEpoch: num(row.minute_epoch),
	usageSeconds: num(row.usage_seconds),
	computeCost: num(row.compute_cost),
	storageCost: num(row.storage_cost),
	bandwidthCost: num(row.bandwidth_cost),
	totalCost: num(row.total_cost),
	hostRate: num(row.host_rate),
	platformTakeRate: num(row.platform_take_rate),
	createdAt: num(row.created_at),
})

export const mapHostEarning = (row: Record<string, unknown>): HostEarning => ({
	id: num(row.id),
	hostId: str(row.host_id),
	workloadId: str(row.workload_id),
	minuteEpoch: num(row.minute_epoch),
	grossRevenue: num(row.gross_revenue),
	platformFee: num(row.platform_fee),
	payout: num(row.payout),
	createdAt: num(row.created_at),
})

export const mapCheckpoint = (row: Record<string, unknown>): Checkpoint => ({
	id: str(row.id),
	workloadId: str(row.workload_id),
	hostId: str(row.host_id),
	runtimeReference: row.runtime_reference ? str(row.runtime_reference) : null,
	metadata: safeJsonParse<Record<string, unknown>>(str(row.metadata, '{}'), {}),
	createdAt: num(row.created_at),
})

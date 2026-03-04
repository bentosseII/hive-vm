export type HostTier = 'consumer' | 'prosumer' | 'datacenter'
export type DaemonStatus = 'stopped' | 'running' | 'draining'

export type WorkloadStatus =
	| 'pending'
	| 'assigned'
	| 'running'
	| 'sleeping'
	| 'stopped'
	| 'failed'
	| 'migrating'

export interface Host {
	id: string
	name: string
	region: string
	tier: HostTier
	cpuTotal: number
	memoryMbTotal: number
	storageGbTotal: number
	minPrice: number
	maxCpuPct: number
	ramCapMb: number | null
	quietHours: string | null
	powerMode: string
	daemonStatus: DaemonStatus
	uptime7d: number
	completionRate: number
	perfScore: number
	networkScore: number
	policyScore: number
	score: number
	lastHeartbeat: number | null
	createdAt: number
	updatedAt: number
}

export interface Pool {
	id: string
	name: string
	isPrivate: boolean
	createdAt: number
}

export interface Workload {
	id: string
	customerId: string
	image: string
	cpu: number
	memoryMb: number
	storageGb: number
	tools: string[]
	persistPolicy: string
	region: string
	tierRequired: HostTier | null
	poolId: string | null
	priceCap: number | null
	status: WorkloadStatus
	hostId: string | null
	runtimeId: string | null
	assignedRate: number | null
	wakeTrigger: string | null
	createdAt: number
	updatedAt: number
	startedAt: number | null
	stoppedAt: number | null
	checkpointId: string | null
	lastError: string | null
}

export interface WorkloadRequest {
	customerId?: string
	image?: string
	cpu: number
	memoryMb: number
	storageGb?: number
	tools?: string[]
	persistPolicy?: string
	region: string
	tierRequired?: HostTier
	poolId?: string
	priceCap?: number
}

export interface Assignment {
	id: number
	workloadId: string
	hostId: string
	action: AssignmentAction
	payload: Record<string, unknown>
	status: 'pending' | 'processing' | 'completed' | 'failed'
	assignedAt: number
	handledAt: number | null
	reason: string | null
}

export type AssignmentAction = 'start' | 'sleep' | 'wake' | 'restore'

export interface UsageEvent {
	id: number
	workloadId: string
	hostId: string
	timestamp: number
	seconds: number
	cpuSeconds: number
	memoryMbAvg: number
	egressMb: number
}

export interface BillingLineItem {
	id: number
	workloadId: string
	hostId: string
	minuteEpoch: number
	usageSeconds: number
	computeCost: number
	storageCost: number
	bandwidthCost: number
	totalCost: number
	hostRate: number
	platformTakeRate: number
	createdAt: number
}

export interface HostEarning {
	id: number
	hostId: string
	workloadId: string
	minuteEpoch: number
	grossRevenue: number
	platformFee: number
	payout: number
	createdAt: number
}

export interface Checkpoint {
	id: string
	workloadId: string
	hostId: string
	runtimeReference: string | null
	metadata: Record<string, unknown>
	createdAt: number
}

export interface PlacementDecision {
	hostId: string
	clearingRate: number
	score: number
	reasons: string[]
}

export interface HostCapacity {
	hostId: string
	availableCpu: number
	availableMemoryMb: number
	availableStorageGb: number
}

export interface BillingSummary {
	from: number
	to: number
	computeTotal: number
	storageTotal: number
	bandwidthTotal: number
	total: number
	lineItems: number
}

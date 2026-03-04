import type { Database } from 'bun:sqlite'
import { mapHost } from '../db/mappers'
import type {
	Host,
	HostCapacity,
	HostTier,
	PlacementDecision,
	WorkloadRequest,
} from '../types/domain'
import { clamp } from '../utils/time'
import type { MarketPricingService } from './marketPricingService'
import type { PoolService } from './poolService'

const TIER_RANK: Record<HostTier, number> = {
	consumer: 1,
	prosumer: 2,
	datacenter: 3,
}

export class SchedulerService {
	constructor(
		private readonly db: Database,
		private readonly poolService: PoolService,
		private readonly pricing: MarketPricingService,
	) {}

	availableCapacity(hostId: string): HostCapacity {
		const hostRow = this.db.query('SELECT * FROM hosts WHERE id = ?1').get(hostId) as Record<
			string,
			unknown
		> | null
		if (!hostRow) {
			throw new Error(`Host not found: ${hostId}`)
		}
		const host = mapHost(hostRow)
		const allocated = this.db
			.query(
				`SELECT COALESCE(SUM(cpu), 0) as cpu_alloc,
						COALESCE(SUM(memory_mb), 0) as mem_alloc,
						COALESCE(SUM(storage_gb), 0) as storage_alloc
				 FROM workloads
				 WHERE host_id = ?1
				   AND status IN ('assigned', 'running', 'migrating')`,
			)
			.get(hostId) as Record<string, unknown>

		const maxCpuByPolicy = Math.floor((host.cpuTotal * host.maxCpuPct) / 100)
		const maxMemByPolicy = host.ramCapMb ?? host.memoryMbTotal

		return {
			hostId,
			availableCpu: Math.max(0, maxCpuByPolicy - Number(allocated.cpu_alloc ?? 0)),
			availableMemoryMb: Math.max(0, maxMemByPolicy - Number(allocated.mem_alloc ?? 0)),
			availableStorageGb: Math.max(0, host.storageGbTotal - Number(allocated.storage_alloc ?? 0)),
		}
	}

	placeWorkload(
		request: WorkloadRequest,
		options: { excludeHostId?: string } = {},
	): PlacementDecision {
		const rows = this.db
			.query(`SELECT * FROM hosts WHERE daemon_status = 'running'`)
			.all() as Array<Record<string, unknown>>
		const candidates = rows.map(mapHost)

		let poolHosts: string[] | null = null
		if (request.poolId) {
			poolHosts = this.poolService.hostIdsInPool(request.poolId)
			if (poolHosts.length === 0) {
				throw new Error(`No hosts available in pool: ${request.poolId}`)
			}
		}

		const evaluated = candidates
			.filter((host) => host.id !== options.excludeHostId)
			.filter((host) => host.region === request.region)
			.filter((host) => {
				if (!request.tierRequired) {
					return true
				}
				return TIER_RANK[host.tier] >= TIER_RANK[request.tierRequired]
			})
			.filter((host) => (poolHosts ? poolHosts.includes(host.id) : true))
			.map((host) => {
				const cap = this.availableCapacity(host.id)
				if (
					cap.availableCpu < request.cpu ||
					cap.availableMemoryMb < request.memoryMb ||
					cap.availableStorageGb < (request.storageGb ?? 10)
				) {
					return null
				}
				const rate = this.pricing.priceForHost(host)
				if (request.priceCap !== undefined && rate > request.priceCap) {
					return null
				}

				const reliability = clamp(host.score / 100, 0, 1)
				const resourceFit = clamp(
					Math.min(
						cap.availableCpu / request.cpu,
						cap.availableMemoryMb / request.memoryMb,
						cap.availableStorageGb / (request.storageGb ?? 10),
					),
					0,
					4,
				)
				const resourceScore = resourceFit / 4
				const priceScore = 1 / (1 + rate * 40)
				const tierBonus = request.tierRequired && host.tier === request.tierRequired ? 1 : 0.7
				const score = reliability * 0.4 + resourceScore * 0.3 + priceScore * 0.2 + tierBonus * 0.1

				return {
					host,
					rate,
					score,
				}
			})
			.filter((entry): entry is { host: Host; rate: number; score: number } => Boolean(entry))
			.sort((a, b) => b.score - a.score)

		const selected = evaluated[0]
		if (!selected) {
			throw new Error('No eligible host found for workload request')
		}

		return {
			hostId: selected.host.id,
			clearingRate: selected.rate,
			score: Number(selected.score.toFixed(4)),
			reasons: [
				`region=${request.region}`,
				`tier=${selected.host.tier}`,
				`hostScore=${selected.host.score.toFixed(2)}`,
				`rate=${selected.rate.toFixed(5)}/hr`,
			],
		}
	}
}

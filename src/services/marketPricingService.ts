import type { Database } from 'bun:sqlite'
import type { Host, HostTier } from '../types/domain'
import { clamp } from '../utils/time'

const BASE_TIER_RATE: Record<HostTier, number> = {
	consumer: 0.02,
	prosumer: 0.035,
	datacenter: 0.05,
}

export class MarketPricingService {
	constructor(private readonly db: Database) {}

	priceForHost(host: Host): number {
		const pressure = this.regionPressure(host.region, host.tier)
		const pressureMultiplier = clamp(0.8 + pressure * 0.6, 0.7, 1.8)
		const reliabilityMultiplier = clamp(1 + (host.score - 70) / 500, 0.85, 1.2)
		const floor = Math.max(BASE_TIER_RATE[host.tier], host.minPrice)
		return Number((floor * pressureMultiplier * reliabilityMultiplier).toFixed(6))
	}

	regionPressure(region: string, tier: HostTier): number {
		const supplyRow = this.db
			.query(
				`SELECT COALESCE(SUM(cpu_total), 0) as cpu_supply
				 FROM hosts
				 WHERE region = ?1 AND tier = ?2 AND daemon_status = 'running'`,
			)
			.get(region, tier) as Record<string, unknown>
		const demandRow = this.db
			.query(
				`SELECT COALESCE(SUM(cpu), 0) as cpu_demand
				 FROM workloads
				 WHERE region = ?1
				   AND status IN ('pending', 'assigned', 'running')
				   AND (tier_required IS NULL OR tier_required = ?2)`,
			)
			.get(region, tier) as Record<string, unknown>

		const supply = Math.max(1, Number(supplyRow.cpu_supply ?? 0))
		const demand = Math.max(0, Number(demandRow.cpu_demand ?? 0))
		return demand / supply
	}
}

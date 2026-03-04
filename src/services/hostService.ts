import type { Database } from 'bun:sqlite'
import { mapHost } from '../db/mappers'
import type { Host, HostTier } from '../types/domain'
import { makeId } from '../utils/ids'
import { nowUnix } from '../utils/time'
import type { ReputationService } from './reputationService'

export interface HostInitInput {
	id?: string
	name?: string
	region?: string
	tier?: HostTier
}

export interface HostSetInput {
	id: string
	cpu?: number
	memoryMb?: number
	storageGb?: number
	minPrice?: number
	maxCpuPct?: number
	ramCapMb?: number
	quietHours?: string
	powerMode?: string
	region?: string
	tier?: HostTier
}

const DEFAULT_HOST = {
	cpuTotal: 4,
	memoryMbTotal: 8192,
	storageGbTotal: 100,
	minPrice: 0.018,
	maxCpuPct: 80,
	powerMode: 'balanced',
	region: 'us-east',
	tier: 'consumer' as HostTier,
}

export class HostService {
	constructor(
		private readonly db: Database,
		private readonly reputation: ReputationService,
	) {}

	initHost(input: HostInitInput): Host {
		const now = nowUnix()
		const id = input.id ?? makeId('host')
		const existing = this.db.query('SELECT * FROM hosts WHERE id = ?1').get(id) as Record<
			string,
			unknown
		> | null
		if (existing) {
			return mapHost(existing)
		}

		const name = input.name ?? id
		const region = input.region ?? DEFAULT_HOST.region
		const tier = input.tier ?? DEFAULT_HOST.tier
		const initialScore = this.reputation.computeScore({
			uptime7d: 95,
			completionRate: 95,
			perfScore: 75,
			networkScore: 75,
			policyScore: 90,
		})

		this.db
			.query(
				`INSERT INTO hosts (
					id, name, region, tier, cpu_total, memory_mb_total, storage_gb_total, min_price,
					max_cpu_pct, power_mode, daemon_status, uptime_7d, completion_rate,
					perf_score, network_score, policy_score, score, created_at, updated_at
				) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'stopped', 95, 95, 75, 75, 90, ?11, ?12, ?12)`,
			)
			.run(
				id,
				name,
				region,
				tier,
				DEFAULT_HOST.cpuTotal,
				DEFAULT_HOST.memoryMbTotal,
				DEFAULT_HOST.storageGbTotal,
				DEFAULT_HOST.minPrice,
				DEFAULT_HOST.maxCpuPct,
				DEFAULT_HOST.powerMode,
				initialScore,
				now,
			)

		return this.getHost(id)
	}

	setHost(input: HostSetInput): Host {
		const host = this.getHost(input.id)
		const now = nowUnix()
		this.db
			.query(
				`UPDATE hosts SET
					cpu_total = ?1,
					memory_mb_total = ?2,
					storage_gb_total = ?3,
					min_price = ?4,
					max_cpu_pct = ?5,
					ram_cap_mb = ?6,
					quiet_hours = ?7,
					power_mode = ?8,
					region = ?9,
					tier = ?10,
					updated_at = ?11
				WHERE id = ?12`,
			)
			.run(
				input.cpu ?? host.cpuTotal,
				input.memoryMb ?? host.memoryMbTotal,
				input.storageGb ?? host.storageGbTotal,
				input.minPrice ?? host.minPrice,
				input.maxCpuPct ?? host.maxCpuPct,
				input.ramCapMb ?? host.ramCapMb,
				input.quietHours ?? host.quietHours,
				input.powerMode ?? host.powerMode,
				input.region ?? host.region,
				input.tier ?? host.tier,
				now,
				input.id,
			)
		this.reputation.refreshHostScore(input.id)
		return this.getHost(input.id)
	}

	setDaemonStatus(hostId: string, status: Host['daemonStatus']) {
		this.db
			.query('UPDATE hosts SET daemon_status = ?1, updated_at = ?2 WHERE id = ?3')
			.run(status, nowUnix(), hostId)
	}

	heartbeat(hostId: string) {
		const now = nowUnix()
		this.db
			.query('UPDATE hosts SET last_heartbeat = ?1, updated_at = ?1 WHERE id = ?2')
			.run(now, hostId)
	}

	getHost(hostId: string): Host {
		const row = this.db.query('SELECT * FROM hosts WHERE id = ?1').get(hostId) as Record<
			string,
			unknown
		> | null
		if (!row) {
			throw new Error(`Host not found: ${hostId}`)
		}
		return mapHost(row)
	}

	listHosts(): Host[] {
		const rows = this.db.query('SELECT * FROM hosts ORDER BY created_at DESC').all() as Array<
			Record<string, unknown>
		>
		return rows.map(mapHost)
	}

	runningHosts(): Host[] {
		const rows = this.db
			.query(`SELECT * FROM hosts WHERE daemon_status = 'running'`)
			.all() as Array<Record<string, unknown>>
		return rows.map(mapHost)
	}

	adjustCompletion(hostId: string, success: boolean) {
		const host = this.getHost(hostId)
		const delta = success ? 0.8 : -2.5
		this.reputation.updateMetrics(host, {
			completionRate: Math.min(100, Math.max(50, host.completionRate + delta)),
		})
	}

	adjustUptime(hostId: string, healthy: boolean) {
		const host = this.getHost(hostId)
		const delta = healthy ? 0.1 : -1
		this.reputation.updateMetrics(host, {
			uptime7d: Math.min(100, Math.max(60, host.uptime7d + delta)),
		})
	}
}

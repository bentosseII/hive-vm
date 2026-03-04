import type { Database } from 'bun:sqlite'
import { mapUsageEvent } from '../db/mappers'
import type { UsageEvent } from '../types/domain'
import { nowUnix } from '../utils/time'

export interface MeteringTick {
	workloadId: string
	hostId: string
	seconds: number
	cpuSeconds: number
	memoryMbAvg: number
	egressMb?: number
	timestamp?: number
}

export class MeteringService {
	constructor(private readonly db: Database) {}

	recordTick(tick: MeteringTick) {
		const timestamp = tick.timestamp ?? nowUnix()
		this.db
			.query(
				`INSERT INTO usage_events (
					workload_id, host_id, timestamp, seconds, cpu_seconds, memory_mb_avg, egress_mb
				) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
			)
			.run(
				tick.workloadId,
				tick.hostId,
				timestamp,
				tick.seconds,
				tick.cpuSeconds,
				tick.memoryMbAvg,
				tick.egressMb ?? 0,
			)
	}

	workloadEvents(workloadId: string, from?: number, to?: number): UsageEvent[] {
		const lower = from ?? 0
		const upper = to ?? nowUnix()
		const rows = this.db
			.query(
				`SELECT * FROM usage_events
				 WHERE workload_id = ?1
				   AND timestamp BETWEEN ?2 AND ?3
				 ORDER BY timestamp ASC`,
			)
			.all(workloadId, lower, upper) as Array<Record<string, unknown>>
		return rows.map(mapUsageEvent)
	}

	workloadSeconds(workloadId: string): number {
		const row = this.db
			.query(
				'SELECT COALESCE(SUM(seconds), 0) as total_seconds FROM usage_events WHERE workload_id = ?1',
			)
			.get(workloadId) as Record<string, unknown>
		return Number(row.total_seconds ?? 0)
	}
}

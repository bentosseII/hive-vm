import type { Database } from 'bun:sqlite'
import { DEFAULT_PLATFORM_TAKE_RATE } from '../config'
import { mapBillingLineItem } from '../db/mappers'
import type { BillingLineItem, BillingSummary } from '../types/domain'
import { minuteBucket, nowUnix } from '../utils/time'

const STORAGE_RATE_PER_GB_HOUR = 0.00035
const BANDWIDTH_RATE_PER_GB = 0.01

export class BillingService {
	constructor(
		private readonly db: Database,
		private readonly platformTakeRate = DEFAULT_PLATFORM_TAKE_RATE,
	) {}

	materializeForWorkload(workloadId: string): BillingLineItem[] {
		const workload = this.db
			.query('SELECT * FROM workloads WHERE id = ?1')
			.get(workloadId) as Record<string, unknown> | null
		if (!workload) {
			throw new Error(`Workload not found: ${workloadId}`)
		}
		const hostId = String(workload.host_id ?? '')
		if (!hostId) {
			return []
		}
		const hostRate = Number(workload.assigned_rate ?? 0)
		const storageGb = Number(workload.storage_gb ?? 0)
		const now = nowUnix()

		const rows = this.db
			.query(
				`SELECT
					CAST(timestamp / 60 AS INTEGER) * 60 as minute_epoch,
					SUM(seconds) as usage_seconds,
					AVG(memory_mb_avg) as memory_mb_avg,
					SUM(egress_mb) as egress_mb
				 FROM usage_events
				 WHERE workload_id = ?1
				 GROUP BY minute_epoch
				 ORDER BY minute_epoch ASC`,
			)
			.all(workloadId) as Array<Record<string, unknown>>

		const values = rows.map((row) => {
			const usageSeconds = Number(row.usage_seconds ?? 0)
			const computeCost = (usageSeconds / 3600) * hostRate
			const storageCost = (usageSeconds / 3600) * storageGb * STORAGE_RATE_PER_GB_HOUR
			const egressMb = Number(row.egress_mb ?? 0)
			const bandwidthCost = (egressMb / 1024) * BANDWIDTH_RATE_PER_GB
			const totalCost = computeCost + storageCost + bandwidthCost
			return {
				minuteEpoch: Number(row.minute_epoch ?? minuteBucket(now)),
				usageSeconds,
				memoryMbAvg: Number(row.memory_mb_avg ?? 0),
				egressMb,
				computeCost,
				storageCost,
				bandwidthCost,
				totalCost,
			}
		})

		for (const value of values) {
			this.db
				.query(
					`INSERT INTO billing_line_items (
						workload_id, host_id, minute_epoch, usage_seconds, compute_cost,
						storage_cost, bandwidth_cost, total_cost, host_rate, platform_take_rate, created_at
					) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
					ON CONFLICT(workload_id, minute_epoch) DO UPDATE SET
						usage_seconds = excluded.usage_seconds,
						compute_cost = excluded.compute_cost,
						storage_cost = excluded.storage_cost,
						bandwidth_cost = excluded.bandwidth_cost,
						total_cost = excluded.total_cost,
						host_rate = excluded.host_rate,
						platform_take_rate = excluded.platform_take_rate,
						created_at = excluded.created_at`,
				)
				.run(
					workloadId,
					hostId,
					value.minuteEpoch,
					value.usageSeconds,
					value.computeCost,
					value.storageCost,
					value.bandwidthCost,
					value.totalCost,
					hostRate,
					this.platformTakeRate,
					now,
				)
		}

		this.db.query('DELETE FROM host_earnings WHERE workload_id = ?1').run(workloadId)
		for (const value of values) {
			const grossRevenue = value.totalCost
			const platformFee = grossRevenue * this.platformTakeRate
			const payout = grossRevenue - platformFee
			this.db
				.query(
					`INSERT INTO host_earnings (
						host_id, workload_id, minute_epoch, gross_revenue, platform_fee, payout, created_at
					) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
				)
				.run(hostId, workloadId, value.minuteEpoch, grossRevenue, platformFee, payout, now)
		}

		const lineRows = this.db
			.query('SELECT * FROM billing_line_items WHERE workload_id = ?1 ORDER BY minute_epoch ASC')
			.all(workloadId) as Array<Record<string, unknown>>
		return lineRows.map(mapBillingLineItem)
	}

	summary(from: number, to: number): BillingSummary {
		const row = this.db
			.query(
				`SELECT
					COUNT(*) as lines,
					COALESCE(SUM(compute_cost), 0) as compute_total,
					COALESCE(SUM(storage_cost), 0) as storage_total,
					COALESCE(SUM(bandwidth_cost), 0) as bandwidth_total,
					COALESCE(SUM(total_cost), 0) as total
				 FROM billing_line_items
				 WHERE minute_epoch BETWEEN ?1 AND ?2`,
			)
			.get(from, to) as Record<string, unknown>
		return {
			from,
			to,
			computeTotal: Number(row.compute_total ?? 0),
			storageTotal: Number(row.storage_total ?? 0),
			bandwidthTotal: Number(row.bandwidth_total ?? 0),
			total: Number(row.total ?? 0),
			lineItems: Number(row.lines ?? 0),
		}
	}

	hostEarnings(hostId: string, from: number, to: number) {
		const row = this.db
			.query(
				`SELECT
					COALESCE(SUM(gross_revenue), 0) as gross,
					COALESCE(SUM(platform_fee), 0) as fee,
					COALESCE(SUM(payout), 0) as payout
				 FROM host_earnings
				 WHERE host_id = ?1 AND minute_epoch BETWEEN ?2 AND ?3`,
			)
			.get(hostId, from, to) as Record<string, unknown>
		return {
			hostId,
			from,
			to,
			gross: Number(row.gross ?? 0),
			platformFee: Number(row.fee ?? 0),
			payout: Number(row.payout ?? 0),
		}
	}
}

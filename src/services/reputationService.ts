import type { Database } from 'bun:sqlite'
import type { Host } from '../types/domain'
import { clamp } from '../utils/time'

export interface HostReputationInputs {
	uptime7d: number
	completionRate: number
	perfScore: number
	networkScore: number
	policyScore: number
}

export class ReputationService {
	constructor(private readonly db: Database) {}

	computeScore(metrics: HostReputationInputs): number {
		const score =
			metrics.uptime7d * 0.35 +
			metrics.completionRate * 0.25 +
			metrics.perfScore * 0.2 +
			metrics.networkScore * 0.1 +
			metrics.policyScore * 0.1
		return Number(clamp(score, 0, 100).toFixed(2))
	}

	refreshHostScore(hostId: string): number {
		const row = this.db
			.query(
				`SELECT uptime_7d, completion_rate, perf_score, network_score, policy_score
				 FROM hosts WHERE id = ?1`,
			)
			.get(hostId) as Record<string, unknown> | null
		if (!row) {
			throw new Error(`Host not found: ${hostId}`)
		}

		const score = this.computeScore({
			uptime7d: Number(row.uptime_7d ?? 0),
			completionRate: Number(row.completion_rate ?? 0),
			perfScore: Number(row.perf_score ?? 0),
			networkScore: Number(row.network_score ?? 0),
			policyScore: Number(row.policy_score ?? 0),
		})

		this.db
			.query('UPDATE hosts SET score = ?1, updated_at = ?2 WHERE id = ?3')
			.run(score, now(), hostId)
		return score
	}

	updateMetrics(host: Host, updates: Partial<HostReputationInputs>): number {
		const next = {
			uptime7d: updates.uptime7d ?? host.uptime7d,
			completionRate: updates.completionRate ?? host.completionRate,
			perfScore: updates.perfScore ?? host.perfScore,
			networkScore: updates.networkScore ?? host.networkScore,
			policyScore: updates.policyScore ?? host.policyScore,
		}
		const score = this.computeScore(next)
		this.db
			.query(
				`UPDATE hosts
				 SET uptime_7d = ?1,
					 completion_rate = ?2,
					 perf_score = ?3,
					 network_score = ?4,
					 policy_score = ?5,
					 score = ?6,
					 updated_at = ?7
				 WHERE id = ?8`,
			)
			.run(
				next.uptime7d,
				next.completionRate,
				next.perfScore,
				next.networkScore,
				next.policyScore,
				score,
				now(),
				host.id,
			)
		return score
	}
}

const now = () => Math.floor(Date.now() / 1000)

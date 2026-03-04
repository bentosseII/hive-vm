import type { Database } from 'bun:sqlite'
import { mapWorkload } from '../db/mappers'
import type { Workload, WorkloadRequest } from '../types/domain'
import { makeId } from '../utils/ids'
import { nowUnix } from '../utils/time'
import type { AssignmentService } from './assignmentService'
import type { SchedulerService } from './schedulerService'

export class WorkloadService {
	constructor(
		private readonly db: Database,
		private readonly scheduler: SchedulerService,
		private readonly assignments: AssignmentService,
	) {}

	spawn(request: WorkloadRequest): Workload {
		const now = nowUnix()
		const workloadId = makeId('vm')

		this.db
			.query(
				`INSERT INTO workloads (
					id, customer_id, image, cpu, memory_mb, storage_gb, tools,
					persist_policy, region, tier_required, pool_id, price_cap, status,
					created_at, updated_at
				) VALUES (
					?1, ?2, ?3, ?4, ?5, ?6, ?7,
					?8, ?9, ?10, ?11, ?12, 'pending',
					?13, ?13
				)`,
			)
			.run(
				workloadId,
				request.customerId ?? 'local',
				request.image ?? 'ghcr.io/hive-vm/base-agent:latest',
				request.cpu,
				request.memoryMb,
				request.storageGb ?? 10,
				JSON.stringify(request.tools ?? []),
				request.persistPolicy ?? 'ephemeral',
				request.region,
				request.tierRequired ?? null,
				request.poolId ?? null,
				request.priceCap ?? null,
				now,
			)

		const decision = this.scheduler.placeWorkload(request)
		this.db
			.query(
				`UPDATE workloads
				 SET status = 'assigned',
					 host_id = ?1,
					 assigned_rate = ?2,
					 updated_at = ?3
				 WHERE id = ?4`,
			)
			.run(decision.hostId, decision.clearingRate, now, workloadId)

		this.assignments.createAssignment(workloadId, decision.hostId, 'start', {
			placementReasons: decision.reasons,
		})
		return this.get(workloadId)
	}

	get(workloadId: string): Workload {
		const row = this.db.query('SELECT * FROM workloads WHERE id = ?1').get(workloadId) as Record<
			string,
			unknown
		> | null
		if (!row) {
			throw new Error(`Workload not found: ${workloadId}`)
		}
		return mapWorkload(row)
	}

	list(): Workload[] {
		const rows = this.db.query('SELECT * FROM workloads ORDER BY created_at DESC').all() as Array<
			Record<string, unknown>
		>
		return rows.map(mapWorkload)
	}

	markRunning(workloadId: string, runtimeId: string) {
		const now = nowUnix()
		this.db
			.query(
				`UPDATE workloads
				 SET status = 'running', runtime_id = ?1, started_at = COALESCE(started_at, ?2), updated_at = ?2
				 WHERE id = ?3`,
			)
			.run(runtimeId, now, workloadId)
	}

	markSleeping(workloadId: string) {
		const now = nowUnix()
		this.db
			.query(
				`UPDATE workloads SET status = 'sleeping', stopped_at = ?1, updated_at = ?1 WHERE id = ?2`,
			)
			.run(now, workloadId)
	}

	markFailed(workloadId: string, reason: string) {
		const now = nowUnix()
		this.db
			.query(
				`UPDATE workloads SET status = 'failed', last_error = ?1, stopped_at = ?2, updated_at = ?2 WHERE id = ?3`,
			)
			.run(reason, now, workloadId)
	}

	sleep(workloadId: string) {
		const workload = this.get(workloadId)
		if (!workload.hostId) {
			throw new Error(`Cannot sleep workload without host assignment: ${workloadId}`)
		}
		if (workload.status !== 'running') {
			throw new Error(`Workload is not running: ${workloadId}`)
		}
		this.db
			.query(`UPDATE workloads SET status = 'assigned', updated_at = ?1 WHERE id = ?2`)
			.run(nowUnix(), workloadId)
		this.assignments.createAssignment(workloadId, workload.hostId, 'sleep')
		return this.get(workloadId)
	}

	wake(workloadId: string, trigger: string) {
		const workload = this.get(workloadId)
		if (!workload.hostId) {
			throw new Error(`Cannot wake workload without host assignment: ${workloadId}`)
		}
		this.db
			.query(
				`UPDATE workloads SET status = 'assigned', wake_trigger = ?1, updated_at = ?2 WHERE id = ?3`,
			)
			.run(trigger, nowUnix(), workloadId)
		this.assignments.createAssignment(workloadId, workload.hostId, 'wake', { trigger })
		return this.get(workloadId)
	}

	requeueOnHost(workloadId: string, hostId: string, checkpointId?: string | null) {
		const now = nowUnix()
		this.db
			.query(
				`UPDATE workloads
				 SET host_id = ?1,
					 runtime_id = NULL,
					 status = 'assigned',
					 checkpoint_id = ?2,
					 updated_at = ?3
				 WHERE id = ?4`,
			)
			.run(hostId, checkpointId ?? null, now, workloadId)
		this.assignments.createAssignment(workloadId, hostId, checkpointId ? 'restore' : 'start', {
			checkpointId: checkpointId ?? null,
		})
	}

	setCheckpoint(workloadId: string, checkpointId: string) {
		this.db
			.query('UPDATE workloads SET checkpoint_id = ?1, updated_at = ?2 WHERE id = ?3')
			.run(checkpointId, nowUnix(), workloadId)
	}

	markMigrating(workloadId: string) {
		this.db
			.query(`UPDATE workloads SET status = 'migrating', updated_at = ?1 WHERE id = ?2`)
			.run(nowUnix(), workloadId)
	}
}

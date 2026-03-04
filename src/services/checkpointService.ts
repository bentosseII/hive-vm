import type { Database } from 'bun:sqlite'
import { mapCheckpoint } from '../db/mappers'
import type { RuntimeAdapter } from '../runtime/types'
import type { Checkpoint } from '../types/domain'
import { makeId } from '../utils/ids'
import { nowUnix } from '../utils/time'
import type { SchedulerService } from './schedulerService'
import type { WorkloadService } from './workloadService'

export class CheckpointService {
	constructor(
		private readonly db: Database,
		private readonly scheduler: SchedulerService,
		private readonly workloads: WorkloadService,
	) {}

	async createCheckpoint(workloadId: string, runtime: RuntimeAdapter): Promise<Checkpoint> {
		const workload = this.workloads.get(workloadId)
		if (!workload.hostId || !workload.runtimeId) {
			throw new Error(`Workload has no active runtime to checkpoint: ${workloadId}`)
		}
		const checkpointId = makeId('ckpt')
		const result = await runtime.checkpoint(workload.runtimeId, checkpointId)
		const now = nowUnix()
		const metadata = {
			supported: result.supported,
			runtimeReference: result.runtimeReference,
			...result.metadata,
		}

		this.db
			.query(
				`INSERT INTO checkpoints (id, workload_id, host_id, runtime_reference, metadata, created_at)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
			)
			.run(
				checkpointId,
				workload.id,
				workload.hostId,
				result.runtimeReference,
				JSON.stringify(metadata),
				now,
			)
		this.workloads.setCheckpoint(workload.id, checkpointId)
		return this.getCheckpoint(checkpointId)
	}

	getCheckpoint(checkpointId: string): Checkpoint {
		const row = this.db
			.query('SELECT * FROM checkpoints WHERE id = ?1')
			.get(checkpointId) as Record<string, unknown> | null
		if (!row) {
			throw new Error(`Checkpoint not found: ${checkpointId}`)
		}
		return mapCheckpoint(row)
	}

	latestForWorkload(workloadId: string): Checkpoint | null {
		const row = this.db
			.query(`SELECT * FROM checkpoints WHERE workload_id = ?1 ORDER BY created_at DESC LIMIT 1`)
			.get(workloadId) as Record<string, unknown> | null
		return row ? mapCheckpoint(row) : null
	}

	async migrateWorkload(
		workloadId: string,
		runtime: RuntimeAdapter,
		toHostId?: string,
	): Promise<{
		workloadId: string
		fromHostId: string
		toHostId: string
		checkpointId: string | null
	}> {
		const workload = this.workloads.get(workloadId)
		if (!workload.hostId) {
			throw new Error(`Workload has no source host: ${workloadId}`)
		}

		let checkpointId: string | null = null
		if (workload.runtimeId && (workload.status === 'running' || workload.status === 'sleeping')) {
			try {
				const checkpoint = await this.createCheckpoint(workloadId, runtime)
				checkpointId = checkpoint.id
			} catch {
				checkpointId = null
			}
		}

		if (workload.runtimeId) {
			try {
				await runtime.stop(workload.runtimeId)
			} catch {
				// ignore runtime stop failures during migration fallback
			}
		}

		let destinationHost = toHostId
		if (!destinationHost) {
			const decision = this.scheduler.placeWorkload(
				{
					cpu: workload.cpu,
					memoryMb: workload.memoryMb,
					storageGb: workload.storageGb,
					region: workload.region,
					poolId: workload.poolId ?? undefined,
					tierRequired: workload.tierRequired ?? undefined,
					priceCap: workload.priceCap ?? undefined,
					persistPolicy: workload.persistPolicy,
					tools: workload.tools,
					image: workload.image,
				},
				{ excludeHostId: workload.hostId },
			)
			destinationHost = decision.hostId
		}

		this.workloads.markMigrating(workloadId)
		this.workloads.requeueOnHost(workloadId, destinationHost, checkpointId)

		return {
			workloadId,
			fromHostId: workload.hostId,
			toHostId: destinationHost,
			checkpointId,
		}
	}
}

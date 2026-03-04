import type { Database } from 'bun:sqlite'
import type { RuntimeAdapter } from '../runtime/types'
import { AssignmentService } from '../services/assignmentService'
import type { HostService } from '../services/hostService'
import { MeteringService } from '../services/meteringService'
import type { WorkloadService } from '../services/workloadService'

export interface HostDaemonOptions {
	hostId: string
	runtime: RuntimeAdapter
	meteringIntervalSeconds?: number
}

export class HostDaemon {
	private readonly assignments: AssignmentService
	private readonly metering: MeteringService
	private readonly meteringIntervalSeconds: number

	constructor(
		private readonly db: Database,
		private readonly hostService: HostService,
		private readonly workloadService: WorkloadService,
		options: HostDaemonOptions,
	) {
		this.assignments = new AssignmentService(db)
		this.metering = new MeteringService(db)
		this.runtime = options.runtime
		this.hostId = options.hostId
		this.meteringIntervalSeconds = options.meteringIntervalSeconds ?? 30
	}

	readonly hostId: string
	readonly runtime: RuntimeAdapter

	async runOnce() {
		this.hostService.heartbeat(this.hostId)
		this.hostService.adjustUptime(this.hostId, true)

		const assignments = this.assignments.nextPendingForHost(this.hostId)
		for (const assignment of assignments) {
			this.assignments.markProcessing(assignment.id)
			try {
				switch (assignment.action) {
					case 'start':
						await this.handleStart(assignment.workloadId)
						break
					case 'wake':
						await this.handleWake(assignment.workloadId, assignment.payload.trigger)
						break
					case 'sleep':
						await this.handleSleep(assignment.workloadId)
						break
					case 'restore':
						await this.handleRestore(assignment.workloadId, assignment.payload.checkpointId)
						break
					default:
						throw new Error(`Unknown assignment action: ${assignment.action}`)
				}
				this.assignments.markCompleted(assignment.id)
				this.hostService.adjustCompletion(this.hostId, true)
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error)
				this.assignments.markFailed(assignment.id, reason)
				this.workloadService.markFailed(assignment.workloadId, reason)
				this.hostService.adjustCompletion(this.hostId, false)
			}
		}

		await this.collectMetering()
	}

	async runForever(intervalMs: number) {
		this.hostService.setDaemonStatus(this.hostId, 'running')
		const stop = { value: false }
		const shutdown = () => {
			stop.value = true
		}
		process.once('SIGINT', shutdown)
		process.once('SIGTERM', shutdown)
		try {
			while (!stop.value) {
				await this.runOnce()
				await Bun.sleep(intervalMs)
			}
		} finally {
			this.hostService.setDaemonStatus(this.hostId, 'stopped')
			process.off('SIGINT', shutdown)
			process.off('SIGTERM', shutdown)
		}
	}

	private async collectMetering() {
		const rows = this.db
			.query(
				`SELECT * FROM workloads
				 WHERE host_id = ?1
				   AND status = 'running'
				   AND runtime_id IS NOT NULL`,
			)
			.all(this.hostId) as Array<Record<string, unknown>>

		for (const row of rows) {
			const workloadId = String(row.id)
			const runtimeId = String(row.runtime_id)
			const cpu = Number(row.cpu)

			const status = await this.runtime.status(runtimeId)
			if (status !== 'running') {
				this.workloadService.markFailed(workloadId, `Runtime ${runtimeId} is ${status}`)
				this.hostService.adjustCompletion(this.hostId, false)
				continue
			}

			const usage = await this.runtime.usage(runtimeId, this.meteringIntervalSeconds, cpu)
			this.metering.recordTick({
				workloadId,
				hostId: this.hostId,
				seconds: this.meteringIntervalSeconds,
				cpuSeconds: usage.cpuSeconds,
				memoryMbAvg: usage.memoryMbAvg,
				egressMb: usage.egressMb,
			})
		}
	}

	private async handleStart(workloadId: string) {
		const workload = this.workloadService.get(workloadId)
		if (workload.hostId !== this.hostId) {
			throw new Error(`Workload ${workloadId} not assigned to host ${this.hostId}`)
		}
		const instance = await this.runtime.launch({
			workloadId,
			image: workload.image,
			cpu: workload.cpu,
			memoryMb: workload.memoryMb,
			storageGb: workload.storageGb,
			env: {
				HIVE_WORKLOAD_ID: workloadId,
				HIVE_TOOLS: workload.tools.join(','),
			},
		})
		this.workloadService.markRunning(workloadId, instance.runtimeId)
	}

	private async handleWake(workloadId: string, trigger: unknown) {
		const workload = this.workloadService.get(workloadId)
		if (workload.hostId !== this.hostId) {
			throw new Error(`Workload ${workloadId} not assigned to host ${this.hostId}`)
		}
		if (workload.runtimeId) {
			const status = await this.runtime.status(workload.runtimeId)
			if (status === 'stopped') {
				const instance = await this.runtime.launch({
					workloadId,
					image: workload.image,
					cpu: workload.cpu,
					memoryMb: workload.memoryMb,
					storageGb: workload.storageGb,
					env: {
						HIVE_WAKE_TRIGGER: String(trigger ?? 'manual'),
					},
				})
				this.workloadService.markRunning(workloadId, instance.runtimeId)
				return
			}
			if (status === 'running') {
				this.workloadService.markRunning(workloadId, workload.runtimeId)
				return
			}
		}
		await this.handleStart(workloadId)
	}

	private async handleSleep(workloadId: string) {
		const workload = this.workloadService.get(workloadId)
		if (!workload.runtimeId) {
			this.workloadService.markSleeping(workloadId)
			return
		}
		await this.runtime.stop(workload.runtimeId)
		this.workloadService.markSleeping(workloadId)
	}

	private async handleRestore(workloadId: string, checkpointId: unknown) {
		const workload = this.workloadService.get(workloadId)
		if (workload.hostId !== this.hostId) {
			throw new Error(`Workload ${workloadId} restore target host mismatch`)
		}

		let checkpointRef: string | undefined
		if (typeof checkpointId === 'string' && checkpointId.trim()) {
			const row = this.db
				.query('SELECT runtime_reference FROM checkpoints WHERE id = ?1')
				.get(checkpointId) as Record<string, unknown> | null
			checkpointRef = row?.runtime_reference ? String(row.runtime_reference) : undefined
		}

		const instance = await this.runtime.launch({
			workloadId,
			image: workload.image,
			cpu: workload.cpu,
			memoryMb: workload.memoryMb,
			storageGb: workload.storageGb,
			checkpointRef,
		})
		this.workloadService.markRunning(workloadId, instance.runtimeId)
	}
}

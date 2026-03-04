import { makeId } from '../utils/ids'
import type {
	LaunchRuntimeInput,
	RuntimeAdapter,
	RuntimeCheckpointResult,
	RuntimeStatus,
	RuntimeUsage,
} from './types'

interface MockRuntimeState {
	status: RuntimeStatus
	cpu: number
	memoryMb: number
	checkpoint?: string
}

export class MockRuntimeAdapter implements RuntimeAdapter {
	kind: 'mock' = 'mock'
	private runtimes = new Map<string, MockRuntimeState>()

	async launch(input: LaunchRuntimeInput) {
		const runtimeId = `mock-${input.workloadId}-${makeId('rt')}`
		this.runtimes.set(runtimeId, {
			status: 'running',
			cpu: input.cpu,
			memoryMb: input.memoryMb,
			checkpoint: input.checkpointRef,
		})
		return { runtimeId }
	}

	async stop(runtimeId: string) {
		const state = this.runtimes.get(runtimeId)
		if (!state) {
			return
		}
		state.status = 'stopped'
	}

	async remove(runtimeId: string) {
		this.runtimes.delete(runtimeId)
	}

	async status(runtimeId: string): Promise<RuntimeStatus> {
		return this.runtimes.get(runtimeId)?.status ?? 'missing'
	}

	async usage(runtimeId: string, intervalSeconds: number, cpuCount: number): Promise<RuntimeUsage> {
		const state = this.runtimes.get(runtimeId)
		if (!state || state.status !== 'running') {
			return {
				cpuSeconds: 0,
				memoryMbAvg: 0,
				egressMb: 0,
			}
		}

		return {
			cpuSeconds: intervalSeconds * cpuCount * 0.5,
			memoryMbAvg: state.memoryMb * 0.65,
			egressMb: intervalSeconds * 0.02,
		}
	}

	async checkpoint(runtimeId: string, checkpointId: string): Promise<RuntimeCheckpointResult> {
		const state = this.runtimes.get(runtimeId)
		if (!state) {
			return {
				supported: false,
				runtimeReference: null,
			}
		}
		state.checkpoint = checkpointId
		return {
			supported: true,
			runtimeReference: checkpointId,
		}
	}
}

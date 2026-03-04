export type RuntimeStatus = 'running' | 'stopped' | 'missing'

export interface LaunchRuntimeInput {
	workloadId: string
	image: string
	cpu: number
	memoryMb: number
	storageGb: number
	env?: Record<string, string>
	command?: string[]
	checkpointRef?: string
}

export interface RuntimeInstance {
	runtimeId: string
	hostReference?: string
}

export interface RuntimeUsage {
	cpuSeconds: number
	memoryMbAvg: number
	egressMb: number
}

export interface RuntimeCheckpointResult {
	supported: boolean
	runtimeReference: string | null
	metadata?: Record<string, unknown>
}

export interface RuntimeAdapter {
	kind: 'docker' | 'mock'
	launch(input: LaunchRuntimeInput): Promise<RuntimeInstance>
	stop(runtimeId: string): Promise<void>
	remove(runtimeId: string): Promise<void>
	status(runtimeId: string): Promise<RuntimeStatus>
	usage(runtimeId: string, intervalSeconds: number, cpuCount: number): Promise<RuntimeUsage>
	checkpoint(runtimeId: string, checkpointId: string): Promise<RuntimeCheckpointResult>
}

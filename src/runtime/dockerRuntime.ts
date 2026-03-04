import { makeId } from '../utils/ids'
import type {
	LaunchRuntimeInput,
	RuntimeAdapter,
	RuntimeCheckpointResult,
	RuntimeStatus,
	RuntimeUsage,
} from './types'

const parseCpuPercent = (raw: string): number => {
	const cleaned = raw.replace('%', '').trim()
	const parsed = Number(cleaned)
	if (Number.isNaN(parsed)) {
		return 0
	}
	return Math.max(0, parsed)
}

const parseMemoryMb = (raw: string): number => {
	const left = raw.split('/')[0]?.trim() ?? '0'
	const match = left.match(/([\d.]+)\s*([kmg]i?b)/i)
	if (!match) {
		return 0
	}
	const amount = Number(match[1])
	const unit = match[2].toLowerCase()
	const scale: Record<string, number> = {
		kib: 1 / 1024,
		kb: 1 / 1000,
		mib: 1,
		mb: 1,
		gib: 1024,
		gb: 1000,
	}
	const multiplier = scale[unit] ?? 1
	return Math.max(0, amount * multiplier)
}

const runDocker = async (args: string[]) => {
	const cmd = Bun.spawn(['docker', ...args], {
		stdout: 'pipe',
		stderr: 'pipe',
	})
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(cmd.stdout).text(),
		new Response(cmd.stderr).text(),
		cmd.exited,
	])
	if (exitCode !== 0) {
		throw new Error(`docker ${args.join(' ')} failed: ${stderr.trim() || stdout.trim()}`)
	}
	return stdout.trim()
}

export class DockerRuntimeAdapter implements RuntimeAdapter {
	kind: 'docker' = 'docker'

	async launch(input: LaunchRuntimeInput) {
		const runtimeId = `hive-${input.workloadId}-${makeId('ctr')}`
		const command = input.command ?? ['sleep', 'infinity']
		const envFlags = Object.entries(input.env ?? {}).flatMap(([key, value]) => [
			'-e',
			`${key}=${value}`,
		])

		const createArgs = [
			'create',
			'--name',
			runtimeId,
			'--cpus',
			String(input.cpu),
			'--memory',
			`${input.memoryMb}m`,
			...envFlags,
			input.image,
			...command,
		]
		await runDocker(createArgs)

		if (input.checkpointRef) {
			try {
				await runDocker(['start', '--checkpoint', input.checkpointRef, runtimeId])
			} catch {
				await runDocker(['start', runtimeId])
			}
		} else {
			await runDocker(['start', runtimeId])
		}

		return { runtimeId }
	}

	async stop(runtimeId: string) {
		await runDocker(['stop', runtimeId])
	}

	async remove(runtimeId: string) {
		await runDocker(['rm', '-f', runtimeId])
	}

	async status(runtimeId: string): Promise<RuntimeStatus> {
		try {
			const output = await runDocker(['inspect', '-f', '{{.State.Status}}', runtimeId])
			if (output === 'running') {
				return 'running'
			}
			if (output === 'exited' || output === 'created') {
				return 'stopped'
			}
			return 'missing'
		} catch {
			return 'missing'
		}
	}

	async usage(runtimeId: string, intervalSeconds: number, cpuCount: number): Promise<RuntimeUsage> {
		try {
			const output = await runDocker([
				'stats',
				'--no-stream',
				'--format',
				'{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}',
				runtimeId,
			])
			const [cpuRaw, memoryRaw, netRaw] = output.split('|')
			const cpuPct = parseCpuPercent(cpuRaw)
			const memoryMbAvg = parseMemoryMb(memoryRaw)
			const cpuSeconds = intervalSeconds * cpuCount * (cpuPct / 100)
			const egressMb = (() => {
				const netOut = netRaw?.split('/')[1]?.trim() ?? '0MB'
				return parseMemoryMb(netOut)
			})()

			return {
				cpuSeconds,
				memoryMbAvg,
				egressMb,
			}
		} catch {
			return {
				cpuSeconds: intervalSeconds * cpuCount * 0.4,
				memoryMbAvg: 0,
				egressMb: 0,
			}
		}
	}

	async checkpoint(runtimeId: string, checkpointId: string): Promise<RuntimeCheckpointResult> {
		try {
			await runDocker(['checkpoint', 'create', runtimeId, checkpointId])
			return {
				supported: true,
				runtimeReference: checkpointId,
			}
		} catch {
			return {
				supported: false,
				runtimeReference: null,
				metadata: {
					note: 'Docker checkpoint unsupported on this host/runtime configuration',
				},
			}
		}
	}
}

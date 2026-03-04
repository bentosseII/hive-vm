#!/usr/bin/env bun

import { basename } from 'node:path'
import { Command } from 'commander'
import packageJson from '../package.json'
import { startApiServer } from './api/server'
import { DEFAULT_PLATFORM_TAKE_RATE } from './config'
import { HostDaemon } from './daemon/hostDaemon'
import { createRuntime } from './runtime'
import { ControlPlane } from './services/controlPlane'
import type { HostTier, WorkloadRequest } from './types/domain'
import {
	parseDateToUnix,
	parseDurationToSeconds,
	parseMemoryToMb,
	parseStorageToGb,
	splitCsv,
} from './utils/parsers'
import { nowUnix } from './utils/time'

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2))

const parseTakeRate = (value: string | undefined) => {
	if (!value) {
		return DEFAULT_PLATFORM_TAKE_RATE
	}
	const parsed = Number(value)
	if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
		throw new Error(`Invalid platform take rate: ${value}`)
	}
	return parsed
}

const withControlPlane = async (
	options: { db?: string; takeRate?: string },
	run: (controlPlane: ControlPlane) => Promise<void> | void,
) => {
	const controlPlane = new ControlPlane({
		path: options.db,
		platformTakeRate: parseTakeRate(options.takeRate),
	})
	try {
		await run(controlPlane)
	} finally {
		controlPlane.close()
	}
}

const ensureHostTier = (value?: string): HostTier | undefined => {
	if (!value) {
		return undefined
	}
	if (value === 'consumer' || value === 'prosumer' || value === 'datacenter') {
		return value
	}
	throw new Error(`Invalid tier: ${value}`)
}

const buildWorkloadRequest = (
	options: Record<string, string | number | boolean | undefined>,
): WorkloadRequest => ({
	cpu: Number(options.cpu),
	memoryMb: parseMemoryToMb(String(options.memory)),
	storageGb: options.storage ? parseStorageToGb(String(options.storage)) : 10,
	tools: splitCsv(typeof options.tools === 'string' ? options.tools : undefined),
	persistPolicy: typeof options.persist === 'string' ? options.persist : 'ephemeral',
	region: typeof options.region === 'string' ? options.region : 'us-east',
	tierRequired: ensureHostTier(typeof options.tier === 'string' ? options.tier : undefined),
	poolId: typeof options.pool === 'string' ? options.pool : undefined,
	image: typeof options.image === 'string' ? options.image : undefined,
	customerId: typeof options.customer === 'string' ? options.customer : undefined,
	priceCap:
		typeof options.priceCap === 'number'
			? options.priceCap
			: typeof options.priceCap === 'string'
				? Number(options.priceCap)
				: undefined,
})

const cliName = basename(process.argv[1] ?? 'hive').replace(/\.m?js$/, '') || 'hive'

const program = new Command()
program
	.name(cliName)
	.version(packageJson.version)
	.description('HiveVM CLI: agent-native compute marketplace (CPU/RAM)')
	.option('--db <path>', 'SQLite DB path')
	.option('--take-rate <ratio>', 'Platform take-rate (0-1)')

const host = program.command('host').description('Host-side operations')

host
	.command('init')
	.description('Initialize host registration')
	.option('--id <hostId>', 'Host id')
	.option('--name <name>', 'Host display name')
	.option('--region <region>', 'Region', 'us-east')
	.option('--tier <tier>', 'consumer|prosumer|datacenter', 'consumer')
	.action(async (options) => {
		const root = program.opts()
		await withControlPlane(root, (cp) => {
			const created = cp.hosts.initHost({
				id: options.id,
				name: options.name,
				region: options.region,
				tier: ensureHostTier(options.tier),
			})
			print(created)
		})
	})

host
	.command('set')
	.description('Set host allocatable resources + pricing policy')
	.requiredOption('--id <hostId>', 'Host id')
	.option('--cpu <count>', 'Allocatable vCPU threads')
	.option('--memory <value>', 'Allocatable memory (e.g. 24gb)')
	.option('--storage <value>', 'Allocatable storage (e.g. 500gb)')
	.option('--min-price <rate>', 'Min acceptable hourly price')
	.option('--max-cpu-pct <pct>', 'Max CPU policy percent')
	.option('--ram-cap <value>', 'RAM hard cap (e.g. 28gb)')
	.option('--quiet-hours <hh:mm-hh:mm>', 'Quiet hours window')
	.option('--power-mode <mode>', 'Power mode', 'balanced')
	.option('--region <region>', 'Region')
	.option('--tier <tier>', 'consumer|prosumer|datacenter')
	.option('--pool <poolIdOrName>', 'Add host to pool after update')
	.action(async (options) => {
		const root = program.opts()
		await withControlPlane(root, (cp) => {
			const hostRecord = cp.hosts.setHost({
				id: options.id,
				cpu: options.cpu ? Number(options.cpu) : undefined,
				memoryMb: options.memory ? parseMemoryToMb(options.memory) : undefined,
				storageGb: options.storage ? parseStorageToGb(options.storage) : undefined,
				minPrice: options.minPrice ? Number(options.minPrice) : undefined,
				maxCpuPct: options.maxCpuPct ? Number(options.maxCpuPct) : undefined,
				ramCapMb: options.ramCap ? parseMemoryToMb(options.ramCap) : undefined,
				quietHours: options.quietHours,
				powerMode: options.powerMode,
				region: options.region,
				tier: ensureHostTier(options.tier),
			})
			if (options.pool) {
				cp.pools.addHostToPool(options.pool, hostRecord.id)
			}
			print(hostRecord)
		})
	})

host
	.command('start')
	.description('Mark host daemon state as running')
	.requiredOption('--id <hostId>', 'Host id')
	.action(async (options) => {
		const root = program.opts()
		await withControlPlane(root, (cp) => {
			cp.hosts.setDaemonStatus(options.id, 'running')
			cp.hosts.heartbeat(options.id)
			print({ hostId: options.id, status: 'running' })
		})
	})

host
	.command('stop')
	.description('Mark host daemon state as stopped')
	.requiredOption('--id <hostId>', 'Host id')
	.action(async (options) => {
		const root = program.opts()
		await withControlPlane(root, (cp) => {
			cp.hosts.setDaemonStatus(options.id, 'stopped')
			print({ hostId: options.id, status: 'stopped' })
		})
	})

host
	.command('daemon')
	.description('Run host daemon to execute assignments + metering')
	.requiredOption('--id <hostId>', 'Host id')
	.option('--runtime <kind>', 'docker|mock', 'docker')
	.option('--interval <seconds>', 'Loop interval seconds', '15')
	.option('--metering-interval <seconds>', 'Metering tick seconds', '30')
	.option('--once', 'Run one loop then exit', false)
	.action(async (options) => {
		const root = program.opts()
		const runtime = createRuntime(options.runtime)
		const intervalSeconds = Number(options.interval)
		const meteringInterval = Number(options.meteringInterval)
		await withControlPlane(root, async (cp) => {
			cp.hosts.setDaemonStatus(options.id, 'running')
			const daemon = new HostDaemon(cp.db.conn, cp.hosts, cp.workloads, {
				hostId: options.id,
				runtime,
				meteringIntervalSeconds: meteringInterval,
			})
			if (options.once) {
				await daemon.runOnce()
				print({ hostId: options.id, ran: 1, mode: 'once' })
				return
			}
			console.log(
				`daemon running host=${options.id} runtime=${runtime.kind} interval=${intervalSeconds}s`,
			)
			await daemon.runForever(intervalSeconds * 1000)
		})
	})

host
	.command('ls')
	.description('List hosts')
	.action(async () => {
		const root = program.opts()
		await withControlPlane(root, (cp) => {
			print({ hosts: cp.hosts.listHosts() })
		})
	})

host
	.command('score')
	.description('Show host reputation score breakdown')
	.requiredOption('--id <hostId>', 'Host id')
	.action(async (options) => {
		const root = program.opts()
		await withControlPlane(root, (cp) => {
			const hostRecord = cp.hosts.getHost(options.id)
			print({
				hostId: hostRecord.id,
				score: hostRecord.score,
				components: {
					uptime7d: hostRecord.uptime7d,
					completionRate: hostRecord.completionRate,
					perfScore: hostRecord.perfScore,
					networkScore: hostRecord.networkScore,
					policyScore: hostRecord.policyScore,
				},
			})
		})
	})

host
	.command('earnings')
	.description('Host payout report')
	.requiredOption('--id <hostId>', 'Host id')
	.option('--last <duration>', 'Range, e.g. 30d', '30d')
	.action(async (options) => {
		const root = program.opts()
		await withControlPlane(root, (cp) => {
			const to = nowUnix()
			const from = to - parseDurationToSeconds(options.last)
			const payout = cp.billing.hostEarnings(options.id, from, to)
			print(payout)
		})
	})

const pools = program.command('pool').description('Private compute pools')

pools
	.command('create')
	.description('Create private pool')
	.argument('<name>', 'Pool name')
	.action(async (name) => {
		const root = program.opts()
		await withControlPlane(root, (cp) => {
			print(cp.pools.createPool(name, true))
		})
	})

pools
	.command('add-host')
	.description('Attach host to pool')
	.argument('<pool>', 'Pool id or name')
	.argument('<hostId>', 'Host id')
	.action(async (pool, hostId) => {
		const root = program.opts()
		await withControlPlane(root, (cp) => {
			cp.pools.addHostToPool(pool, hostId)
			print({ ok: true, pool, hostId })
		})
	})

pools
	.command('ls')
	.description('List pools')
	.action(async () => {
		const root = program.opts()
		await withControlPlane(root, (cp) => {
			print({ pools: cp.pools.listPools() })
		})
	})

program
	.command('spawn')
	.description('Spawn agent-native workload')
	.requiredOption('--cpu <count>', 'vCPU count')
	.requiredOption('--memory <value>', 'Memory e.g. 4gb')
	.option('--storage <value>', 'Storage e.g. 50gb', '10gb')
	.option('--tools <csv>', 'Tool list', '')
	.option('--persist <policy>', 'ephemeral|persist-7d|persist-30d', 'ephemeral')
	.option('--region <region>', 'Region', 'us-east')
	.option('--tier <tier>', 'consumer|prosumer|datacenter')
	.option('--pool <poolIdOrName>', 'Private pool requirement')
	.option('--image <image>', 'OCI image', 'ghcr.io/hive-vm/base-agent:latest')
	.option('--customer <id>', 'Customer id', 'local')
	.option('--price-cap <value>', 'Hourly price ceiling')
	.action(async (options) => {
		const root = program.opts()
		await withControlPlane(root, (cp) => {
			const request = buildWorkloadRequest(options)
			const workload = cp.workloads.spawn(request)
			print(workload)
		})
	})

program
	.command('ls')
	.description('List workloads')
	.action(async () => {
		const root = program.opts()
		await withControlPlane(root, (cp) => {
			print({ workloads: cp.workloads.list() })
		})
	})

program
	.command('logs')
	.description('Show workload status + metering summary')
	.argument('<workloadId>', 'Workload id')
	.action(async (workloadId) => {
		const root = program.opts()
		await withControlPlane(root, (cp) => {
			const workload = cp.workloads.get(workloadId)
			const usageSeconds = cp.metering.workloadSeconds(workloadId)
			const billing = cp.billing.materializeForWorkload(workloadId)
			const total = billing.reduce((sum, item) => sum + item.totalCost, 0)
			print({
				workload,
				usageSeconds,
				billableMinutes: billing.length,
				totalCost: Number(total.toFixed(6)),
			})
		})
	})

program
	.command('sleep')
	.description('Hibernate workload')
	.argument('<workloadId>', 'Workload id')
	.action(async (workloadId) => {
		const root = program.opts()
		await withControlPlane(root, (cp) => {
			print(cp.workloads.sleep(workloadId))
		})
	})

program
	.command('wake')
	.description('Wake workload from hibernate')
	.argument('<workloadId>', 'Workload id')
	.option('--on <trigger>', 'Trigger source', 'manual')
	.action(async (workloadId, options) => {
		const root = program.opts()
		await withControlPlane(root, (cp) => {
			print(cp.workloads.wake(workloadId, options.on))
		})
	})

program
	.command('checkpoint')
	.description('Create workload checkpoint')
	.argument('<workloadId>', 'Workload id')
	.option('--runtime <kind>', 'docker|mock', 'docker')
	.action(async (workloadId, options) => {
		const root = program.opts()
		const runtime = createRuntime(options.runtime)
		await withControlPlane(root, async (cp) => {
			print(await cp.checkpoints.createCheckpoint(workloadId, runtime))
		})
	})

program
	.command('migrate')
	.description('Migrate workload to another host via checkpoint/restore')
	.argument('<workloadId>', 'Workload id')
	.option('--to-host <hostId>', 'Destination host id')
	.option('--runtime <kind>', 'docker|mock', 'docker')
	.action(async (workloadId, options) => {
		const root = program.opts()
		const runtime = createRuntime(options.runtime)
		await withControlPlane(root, async (cp) => {
			print(await cp.checkpoints.migrateWorkload(workloadId, runtime, options.toHost))
		})
	})

const bill = program.command('bill').description('Billing + payout')

bill
	.command('usage')
	.description('Usage billing summary')
	.option('--from <isoDate>', 'From timestamp/date')
	.option('--to <isoDate>', 'To timestamp/date')
	.action(async (options) => {
		const root = program.opts()
		await withControlPlane(root, (cp) => {
			const now = nowUnix()
			const from = options.from ? parseDateToUnix(options.from) : now - 7 * 24 * 3600
			const to = options.to ? parseDateToUnix(options.to) : now
			print(cp.billing.summary(from, to))
		})
	})

bill
	.command('settle')
	.description('Materialize billing line items from usage events')
	.option('--workload <id>', 'Single workload id')
	.action(async (options) => {
		const root = program.opts()
		await withControlPlane(root, (cp) => {
			const workloadIds = options.workload
				? [options.workload]
				: cp.workloads
						.list()
						.filter((workload) => workload.hostId)
						.map((workload) => workload.id)
			const settled = workloadIds.map((workloadId: string) => ({
				workloadId,
				lineItems: cp.billing.materializeForWorkload(workloadId).length,
			}))
			print({ settled })
		})
	})

const api = program.command('api').description('Control plane API server')

api
	.command('start')
	.description('Start API server')
	.option('--port <port>', 'Port', '8787')
	.option('--runtime <kind>', 'docker|mock', 'docker')
	.action(async (options) => {
		const root = program.opts()
		const runtime = createRuntime(options.runtime)
		const controlPlane = new ControlPlane({
			path: root.db,
			platformTakeRate: parseTakeRate(root.takeRate),
		})
		const port = Number(options.port)
		const server = startApiServer(controlPlane, runtime, port)
		console.log(`api listening on http://localhost:${server.port}`)
		process.on('SIGINT', () => {
			server.stop(true)
			controlPlane.close()
			process.exit(0)
		})
		await new Promise(() => {})
	})

program.parseAsync(process.argv).catch((error) => {
	console.error(error instanceof Error ? error.message : String(error))
	process.exit(1)
})

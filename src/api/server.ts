import type { RuntimeAdapter } from '../runtime/types'
import type { ControlPlane } from '../services/controlPlane'
import { parseDateToUnix } from '../utils/parsers'
import { nowUnix } from '../utils/time'

const json = (body: unknown, init: ResponseInit = {}) =>
	new Response(JSON.stringify(body, null, 2), {
		...init,
		headers: {
			'content-type': 'application/json',
			...(init.headers ?? {}),
		},
	})

const readJsonBody = async (request: Request): Promise<Record<string, unknown>> => {
	try {
		return (await request.json()) as Record<string, unknown>
	} catch {
		return {}
	}
}

const parseRange = (url: URL) => {
	const now = nowUnix()
	const fromRaw = url.searchParams.get('from')
	const toRaw = url.searchParams.get('to')
	const from = fromRaw ? parseDateToUnix(fromRaw) : now - 7 * 24 * 3600
	const to = toRaw ? parseDateToUnix(toRaw) : now
	return { from, to }
}

export const startApiServer = (
	controlPlane: ControlPlane,
	runtime: RuntimeAdapter,
	port: number,
) => {
	return Bun.serve({
		port,
		async fetch(request) {
			const url = new URL(request.url)
			const path = url.pathname

			try {
				if (request.method === 'GET' && path === '/health') {
					return json({
						status: 'ok',
						now: nowUnix(),
						runtime: runtime.kind,
					})
				}

				if (request.method === 'POST' && path === '/hosts/init') {
					const body = await readJsonBody(request)
					const host = controlPlane.hosts.initHost({
						id: typeof body.id === 'string' ? body.id : undefined,
						name: typeof body.name === 'string' ? body.name : undefined,
						region: typeof body.region === 'string' ? body.region : undefined,
						tier: typeof body.tier === 'string' ? (body.tier as never) : undefined,
					})
					return json(host, { status: 201 })
				}

				if (request.method === 'POST' && path === '/hosts/set') {
					const body = await readJsonBody(request)
					if (typeof body.id !== 'string') {
						return json({ error: 'id is required' }, { status: 400 })
					}
					const host = controlPlane.hosts.setHost({
						id: body.id,
						cpu: typeof body.cpu === 'number' ? body.cpu : undefined,
						memoryMb: typeof body.memoryMb === 'number' ? body.memoryMb : undefined,
						storageGb: typeof body.storageGb === 'number' ? body.storageGb : undefined,
						minPrice: typeof body.minPrice === 'number' ? body.minPrice : undefined,
						maxCpuPct: typeof body.maxCpuPct === 'number' ? body.maxCpuPct : undefined,
						ramCapMb: typeof body.ramCapMb === 'number' ? body.ramCapMb : undefined,
						quietHours: typeof body.quietHours === 'string' ? body.quietHours : undefined,
						powerMode: typeof body.powerMode === 'string' ? body.powerMode : undefined,
						region: typeof body.region === 'string' ? body.region : undefined,
						tier: typeof body.tier === 'string' ? (body.tier as never) : undefined,
					})
					return json(host)
				}

				if (request.method === 'GET' && path === '/hosts') {
					return json({ hosts: controlPlane.hosts.listHosts() })
				}

				if (request.method === 'POST' && path === '/pools') {
					const body = await readJsonBody(request)
					if (typeof body.name !== 'string') {
						return json({ error: 'name is required' }, { status: 400 })
					}
					const pool = controlPlane.pools.createPool(body.name, body.private !== false)
					return json(pool, { status: 201 })
				}

				if (request.method === 'GET' && path === '/pools') {
					return json({ pools: controlPlane.pools.listPools() })
				}

				const poolHostMatch = path.match(/^\/pools\/([^/]+)\/hosts\/([^/]+)$/)
				if (request.method === 'POST' && poolHostMatch) {
					controlPlane.pools.addHostToPool(poolHostMatch[1], poolHostMatch[2])
					return json({ ok: true })
				}

				if (request.method === 'POST' && path === '/workloads/spawn') {
					const body = await readJsonBody(request)
					const workload = controlPlane.workloads.spawn({
						cpu: Number(body.cpu),
						memoryMb: Number(body.memoryMb),
						storageGb: typeof body.storageGb === 'number' ? body.storageGb : undefined,
						region: String(body.region ?? 'us-east'),
						persistPolicy: typeof body.persistPolicy === 'string' ? body.persistPolicy : undefined,
						poolId: typeof body.poolId === 'string' ? body.poolId : undefined,
						tierRequired:
							typeof body.tierRequired === 'string' ? (body.tierRequired as never) : undefined,
						tools: Array.isArray(body.tools) ? body.tools.map((item) => String(item)) : undefined,
						image: typeof body.image === 'string' ? body.image : undefined,
						priceCap: typeof body.priceCap === 'number' ? body.priceCap : undefined,
						customerId: typeof body.customerId === 'string' ? body.customerId : undefined,
					})
					return json(workload, { status: 201 })
				}

				if (request.method === 'GET' && path === '/workloads') {
					return json({ workloads: controlPlane.workloads.list() })
				}

				const workloadIdMatch = path.match(/^\/workloads\/([^/]+)$/)
				if (request.method === 'GET' && workloadIdMatch) {
					return json(controlPlane.workloads.get(workloadIdMatch[1]))
				}

				const sleepMatch = path.match(/^\/workloads\/([^/]+)\/sleep$/)
				if (request.method === 'POST' && sleepMatch) {
					return json(controlPlane.workloads.sleep(sleepMatch[1]))
				}

				const wakeMatch = path.match(/^\/workloads\/([^/]+)\/wake$/)
				if (request.method === 'POST' && wakeMatch) {
					const body = await readJsonBody(request)
					return json(controlPlane.workloads.wake(wakeMatch[1], String(body.trigger ?? 'manual')))
				}

				const ckptMatch = path.match(/^\/workloads\/([^/]+)\/checkpoint$/)
				if (request.method === 'POST' && ckptMatch) {
					const checkpoint = await controlPlane.checkpoints.createCheckpoint(ckptMatch[1], runtime)
					return json(checkpoint)
				}

				const migrateMatch = path.match(/^\/workloads\/([^/]+)\/migrate$/)
				if (request.method === 'POST' && migrateMatch) {
					const body = await readJsonBody(request)
					const result = await controlPlane.checkpoints.migrateWorkload(
						migrateMatch[1],
						runtime,
						typeof body.toHostId === 'string' ? body.toHostId : undefined,
					)
					return json(result)
				}

				const billMaterialize = path.match(/^\/billing\/materialize\/([^/]+)$/)
				if (request.method === 'POST' && billMaterialize) {
					return json({
						items: controlPlane.billing.materializeForWorkload(billMaterialize[1]),
					})
				}

				if (request.method === 'GET' && path === '/billing/summary') {
					const range = parseRange(url)
					return json(controlPlane.billing.summary(range.from, range.to))
				}

				return json({ error: 'Not Found' }, { status: 404 })
			} catch (error) {
				return json(
					{ error: error instanceof Error ? error.message : String(error) },
					{ status: 500 },
				)
			}
		},
	})
}

import { afterEach, describe, expect, test } from 'bun:test'
import { startApiServer } from '../src/api/server'
import { MockRuntimeAdapter } from '../src/runtime/mockRuntime'
import { ControlPlane } from '../src/services/controlPlane'
import { createTempDb } from './helpers'

const servers: Array<{ stop: () => void; close: () => void; cleanup: () => void }> = []

afterEach(() => {
	for (const item of servers.splice(0)) {
		item.stop()
		item.close()
		item.cleanup()
	}
})

describe('api server', () => {
	test('serves host/workload lifecycle endpoints', async () => {
		const temp = createTempDb()
		const cp = new ControlPlane({ path: temp.dbPath })
		const runtime = new MockRuntimeAdapter()
		const server = startApiServer(cp, runtime, 0)
		servers.push({
			stop: () => server.stop(true),
			close: () => cp.close(),
			cleanup: () => temp.cleanup(),
		})

		const base = `http://127.0.0.1:${server.port}`

		const hostInit = await fetch(`${base}/hosts/init`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id: 'api-host', region: 'us-east', tier: 'prosumer' }),
		})
		expect(hostInit.status).toBe(201)

		const hostSet = await fetch(`${base}/hosts/set`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				id: 'api-host',
				cpu: 6,
				memoryMb: 12288,
				storageGb: 200,
				minPrice: 0.02,
			}),
		})
		expect(hostSet.status).toBe(200)
		cp.hosts.setDaemonStatus('api-host', 'running')

		const spawned = await fetch(`${base}/workloads/spawn`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				cpu: 1,
				memoryMb: 1024,
				storageGb: 10,
				region: 'us-east',
			}),
		})
		expect(spawned.status).toBe(201)
		const spawnedBody = (await spawned.json()) as { id: string }
		expect(spawnedBody.id).toStartWith('vm_')

		const list = await fetch(`${base}/workloads`)
		const listBody = (await list.json()) as { workloads: Array<{ id: string }> }
		expect(listBody.workloads.length).toBe(1)
	})
})

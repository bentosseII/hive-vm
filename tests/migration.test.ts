import { describe, expect, test } from 'bun:test'
import { HostDaemon } from '../src/daemon/hostDaemon'
import { MockRuntimeAdapter } from '../src/runtime/mockRuntime'
import { ControlPlane } from '../src/services/controlPlane'
import { createTempDb } from './helpers'

describe('checkpoint migration', () => {
	test('migrates workload between hosts', async () => {
		const temp = createTempDb()
		const runtime = new MockRuntimeAdapter()
		const cp = new ControlPlane({ path: temp.dbPath })

		cp.hosts.initHost({ id: 'host-1', region: 'us-east', tier: 'prosumer' })
		cp.hosts.setHost({ id: 'host-1', cpu: 8, memoryMb: 16384, storageGb: 200, minPrice: 0.01 })
		cp.hosts.setDaemonStatus('host-1', 'running')

		cp.hosts.initHost({ id: 'host-2', region: 'us-east', tier: 'prosumer' })
		cp.hosts.setHost({ id: 'host-2', cpu: 8, memoryMb: 16384, storageGb: 200, minPrice: 0.02 })
		cp.hosts.setDaemonStatus('host-2', 'running')

		const daemon1 = new HostDaemon(cp.db.conn, cp.hosts, cp.workloads, {
			hostId: 'host-1',
			runtime,
			meteringIntervalSeconds: 30,
		})
		const daemon2 = new HostDaemon(cp.db.conn, cp.hosts, cp.workloads, {
			hostId: 'host-2',
			runtime,
			meteringIntervalSeconds: 30,
		})

		const workload = cp.workloads.spawn({
			cpu: 2,
			memoryMb: 2048,
			storageGb: 10,
			region: 'us-east',
		})

		await daemon1.runOnce()
		let current = cp.workloads.get(workload.id)
		expect(current.hostId).toBe('host-1')
		expect(current.status).toBe('running')

		const result = await cp.checkpoints.migrateWorkload(workload.id, runtime, 'host-2')
		expect(result.fromHostId).toBe('host-1')
		expect(result.toHostId).toBe('host-2')

		await daemon2.runOnce()
		current = cp.workloads.get(workload.id)
		expect(current.hostId).toBe('host-2')
		expect(current.status).toBe('running')
		expect(current.checkpointId).toBeString()

		cp.close()
		temp.cleanup()
	})
})

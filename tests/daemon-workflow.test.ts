import { describe, expect, test } from 'bun:test'
import { HostDaemon } from '../src/daemon/hostDaemon'
import { MockRuntimeAdapter } from '../src/runtime/mockRuntime'
import { ControlPlane } from '../src/services/controlPlane'
import { createTempDb } from './helpers'

describe('daemon workflow', () => {
	test('spawn -> run -> sleep -> wake with metering + billing', async () => {
		const temp = createTempDb()
		const runtime = new MockRuntimeAdapter()
		const cp = new ControlPlane({ path: temp.dbPath })

		cp.hosts.initHost({ id: 'host-a', region: 'us-east', tier: 'prosumer' })
		cp.hosts.setHost({ id: 'host-a', cpu: 12, memoryMb: 32768, storageGb: 500, minPrice: 0.02 })
		cp.hosts.setDaemonStatus('host-a', 'running')

		const workload = cp.workloads.spawn({
			cpu: 2,
			memoryMb: 4096,
			storageGb: 20,
			region: 'us-east',
			tools: ['github', 'browser'],
			persistPolicy: 'persist-7d',
		})

		const daemon = new HostDaemon(cp.db.conn, cp.hosts, cp.workloads, {
			hostId: 'host-a',
			runtime,
			meteringIntervalSeconds: 30,
		})

		await daemon.runOnce()
		let current = cp.workloads.get(workload.id)
		expect(current.status).toBe('running')
		expect(current.runtimeId).toBeString()

		await daemon.runOnce()
		expect(cp.metering.workloadSeconds(workload.id)).toBeGreaterThan(0)

		cp.workloads.sleep(workload.id)
		await daemon.runOnce()
		current = cp.workloads.get(workload.id)
		expect(current.status).toBe('sleeping')

		cp.workloads.wake(workload.id, 'webhook')
		await daemon.runOnce()
		current = cp.workloads.get(workload.id)
		expect(current.status).toBe('running')

		const bill = cp.billing.materializeForWorkload(workload.id)
		expect(bill.length).toBeGreaterThan(0)
		expect(bill.reduce((sum, item) => sum + item.totalCost, 0)).toBeGreaterThan(0)

		cp.close()
		temp.cleanup()
	})
})

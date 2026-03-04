import { afterEach, describe, expect, test } from 'bun:test'
import { ControlPlane } from '../src/services/controlPlane'
import { createTempDb } from './helpers'

const cleanups: Array<() => void> = []

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) {
		cleanup()
	}
})

describe('scheduler placement', () => {
	test('enforces tier and picks eligible host', () => {
		const temp = createTempDb()
		cleanups.push(temp.cleanup)
		const cp = new ControlPlane({ path: temp.dbPath })

		cp.hosts.initHost({ id: 'host-consumer', region: 'us-east', tier: 'consumer' })
		cp.hosts.setHost({
			id: 'host-consumer',
			cpu: 8,
			memoryMb: 16384,
			storageGb: 300,
			minPrice: 0.01,
		})
		cp.hosts.setDaemonStatus('host-consumer', 'running')

		cp.hosts.initHost({ id: 'host-pro', region: 'us-east', tier: 'prosumer' })
		cp.hosts.setHost({
			id: 'host-pro',
			cpu: 8,
			memoryMb: 16384,
			storageGb: 300,
			minPrice: 0.02,
		})
		cp.hosts.setDaemonStatus('host-pro', 'running')

		const decision = cp.scheduler.placeWorkload({
			cpu: 2,
			memoryMb: 4096,
			region: 'us-east',
			tierRequired: 'prosumer',
		})

		expect(decision.hostId).toBe('host-pro')
		expect(decision.clearingRate).toBeGreaterThan(0)

		cp.close()
	})

	test('respects private pool filter', () => {
		const temp = createTempDb()
		cleanups.push(temp.cleanup)
		const cp = new ControlPlane({ path: temp.dbPath })

		cp.hosts.initHost({ id: 'h1', region: 'us-east', tier: 'consumer' })
		cp.hosts.setHost({ id: 'h1', cpu: 4, memoryMb: 8192, storageGb: 100, minPrice: 0.03 })
		cp.hosts.setDaemonStatus('h1', 'running')

		cp.hosts.initHost({ id: 'h2', region: 'us-east', tier: 'consumer' })
		cp.hosts.setHost({ id: 'h2', cpu: 4, memoryMb: 8192, storageGb: 100, minPrice: 0.01 })
		cp.hosts.setDaemonStatus('h2', 'running')

		const pool = cp.pools.createPool('enterprise-red', true)
		cp.pools.addHostToPool(pool.id, 'h1')

		const decision = cp.scheduler.placeWorkload({
			cpu: 1,
			memoryMb: 1024,
			region: 'us-east',
			poolId: pool.id,
		})

		expect(decision.hostId).toBe('h1')
		cp.close()
	})
})

import { describe, expect, test } from 'bun:test'
import { BillingService } from '../src/services/billingService'
import { ControlPlane } from '../src/services/controlPlane'
import { createTempDb } from './helpers'

describe('billing and payouts', () => {
	test('computes per-minute line items and host payouts', () => {
		const temp = createTempDb()
		const cp = new ControlPlane({ path: temp.dbPath, platformTakeRate: 0.25 })
		const billing = new BillingService(cp.db.conn, 0.25)

		cp.hosts.initHost({ id: 'bill-host', region: 'us-east', tier: 'prosumer' })
		cp.hosts.setHost({ id: 'bill-host', cpu: 8, memoryMb: 16384, storageGb: 200, minPrice: 0.02 })
		cp.hosts.setDaemonStatus('bill-host', 'running')

		const workload = cp.workloads.spawn({
			cpu: 2,
			memoryMb: 2048,
			storageGb: 50,
			region: 'us-east',
		})

		cp.db.conn
			.query(
				`UPDATE workloads SET host_id = 'bill-host', assigned_rate = 0.03, status = 'running' WHERE id = ?1`,
			)
			.run(workload.id)

		cp.metering.recordTick({
			workloadId: workload.id,
			hostId: 'bill-host',
			seconds: 30,
			cpuSeconds: 20,
			memoryMbAvg: 1500,
			egressMb: 50,
			timestamp: 1_700_000_010,
		})
		cp.metering.recordTick({
			workloadId: workload.id,
			hostId: 'bill-host',
			seconds: 30,
			cpuSeconds: 18,
			memoryMbAvg: 1520,
			egressMb: 30,
			timestamp: 1_700_000_040,
		})

		const items = billing.materializeForWorkload(workload.id)
		expect(items.length).toBe(2)
		expect(items.reduce((sum, item) => sum + item.usageSeconds, 0)).toBe(60)
		expect(items[0]?.totalCost).toBeGreaterThan(0)

		const earnings = billing.hostEarnings('bill-host', 1_699_999_000, 1_700_001_000)
		expect(earnings.gross).toBeGreaterThan(0)
		expect(earnings.platformFee).toBeGreaterThan(0)
		expect(earnings.payout).toBeCloseTo(earnings.gross * 0.75, 6)

		cp.close()
		temp.cleanup()
	})
})

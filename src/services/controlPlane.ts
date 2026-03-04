import { type DbOptions, HiveDb } from '../db/client'
import { AssignmentService } from './assignmentService'
import { BillingService } from './billingService'
import { CheckpointService } from './checkpointService'
import { HostService } from './hostService'
import { MarketPricingService } from './marketPricingService'
import { MeteringService } from './meteringService'
import { PoolService } from './poolService'
import { ReputationService } from './reputationService'
import { SchedulerService } from './schedulerService'
import { WorkloadService } from './workloadService'

export interface ControlPlaneOptions extends DbOptions {
	platformTakeRate?: number
}

export class ControlPlane {
	readonly db: HiveDb
	readonly reputation: ReputationService
	readonly hosts: HostService
	readonly pools: PoolService
	readonly pricing: MarketPricingService
	readonly scheduler: SchedulerService
	readonly assignments: AssignmentService
	readonly workloads: WorkloadService
	readonly metering: MeteringService
	readonly billing: BillingService
	readonly checkpoints: CheckpointService

	constructor(options: ControlPlaneOptions = {}) {
		this.db = new HiveDb({ path: options.path })
		this.reputation = new ReputationService(this.db.conn)
		this.hosts = new HostService(this.db.conn, this.reputation)
		this.pools = new PoolService(this.db.conn)
		this.pricing = new MarketPricingService(this.db.conn)
		this.scheduler = new SchedulerService(this.db.conn, this.pools, this.pricing)
		this.assignments = new AssignmentService(this.db.conn)
		this.workloads = new WorkloadService(this.db.conn, this.scheduler, this.assignments)
		this.metering = new MeteringService(this.db.conn)
		this.billing = new BillingService(this.db.conn, options.platformTakeRate)
		this.checkpoints = new CheckpointService(this.db.conn, this.scheduler, this.workloads)
	}

	close() {
		this.db.close()
	}
}

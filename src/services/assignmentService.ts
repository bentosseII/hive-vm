import type { Database } from 'bun:sqlite'
import { mapAssignment } from '../db/mappers'
import type { Assignment, AssignmentAction } from '../types/domain'
import { nowUnix } from '../utils/time'

export class AssignmentService {
	constructor(private readonly db: Database) {}

	createAssignment(
		workloadId: string,
		hostId: string,
		action: AssignmentAction,
		payload: Record<string, unknown> = {},
	): Assignment {
		const now = nowUnix()
		this.db
			.query(
				`INSERT INTO assignments (workload_id, host_id, action, payload, status, assigned_at)
				 VALUES (?1, ?2, ?3, ?4, 'pending', ?5)`,
			)
			.run(workloadId, hostId, action, JSON.stringify(payload), now)
		const row = this.db
			.query('SELECT * FROM assignments WHERE id = last_insert_rowid()')
			.get() as Record<string, unknown>
		return mapAssignment(row)
	}

	nextPendingForHost(hostId: string, limit = 25): Assignment[] {
		const rows = this.db
			.query(
				`SELECT * FROM assignments
				 WHERE host_id = ?1 AND status = 'pending'
				 ORDER BY assigned_at ASC
				 LIMIT ?2`,
			)
			.all(hostId, limit) as Array<Record<string, unknown>>
		return rows.map(mapAssignment)
	}

	markProcessing(assignmentId: number) {
		this.db.query(`UPDATE assignments SET status = 'processing' WHERE id = ?1`).run(assignmentId)
	}

	markCompleted(assignmentId: number) {
		const now = nowUnix()
		this.db
			.query(`UPDATE assignments SET status = 'completed', handled_at = ?1 WHERE id = ?2`)
			.run(now, assignmentId)
	}

	markFailed(assignmentId: number, reason: string) {
		const now = nowUnix()
		this.db
			.query(`UPDATE assignments SET status = 'failed', handled_at = ?1, reason = ?2 WHERE id = ?3`)
			.run(now, reason, assignmentId)
	}
}

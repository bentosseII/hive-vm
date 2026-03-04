import type { Database } from 'bun:sqlite'
import { mapPool } from '../db/mappers'
import type { Pool } from '../types/domain'
import { makeId } from '../utils/ids'
import { nowUnix } from '../utils/time'

export class PoolService {
	constructor(private readonly db: Database) {}

	createPool(name: string, isPrivate = true): Pool {
		const now = nowUnix()
		const existing = this.db.query('SELECT * FROM pools WHERE name = ?1').get(name) as Record<
			string,
			unknown
		> | null
		if (existing) {
			return mapPool(existing)
		}
		const poolId = makeId('pool')
		this.db
			.query('INSERT INTO pools (id, name, is_private, created_at) VALUES (?1, ?2, ?3, ?4)')
			.run(poolId, name, isPrivate ? 1 : 0, now)
		const created = this.db.query('SELECT * FROM pools WHERE id = ?1').get(poolId) as Record<
			string,
			unknown
		>
		return mapPool(created)
	}

	listPools(): Pool[] {
		const rows = this.db.query('SELECT * FROM pools ORDER BY created_at DESC').all() as Record<
			string,
			unknown
		>[]
		return rows.map(mapPool)
	}

	getPool(poolIdOrName: string): Pool | null {
		const row = this.db
			.query('SELECT * FROM pools WHERE id = ?1 OR name = ?1 LIMIT 1')
			.get(poolIdOrName) as Record<string, unknown> | null
		return row ? mapPool(row) : null
	}

	addHostToPool(poolIdOrName: string, hostId: string) {
		const pool = this.getPool(poolIdOrName)
		if (!pool) {
			throw new Error(`Pool not found: ${poolIdOrName}`)
		}
		this.db
			.query('INSERT OR IGNORE INTO pool_members (pool_id, host_id) VALUES (?1, ?2)')
			.run(pool.id, hostId)
	}

	removeHostFromPool(poolIdOrName: string, hostId: string) {
		const pool = this.getPool(poolIdOrName)
		if (!pool) {
			throw new Error(`Pool not found: ${poolIdOrName}`)
		}
		this.db
			.query('DELETE FROM pool_members WHERE pool_id = ?1 AND host_id = ?2')
			.run(pool.id, hostId)
	}

	hostPoolIds(hostId: string): string[] {
		const rows = this.db
			.query('SELECT pool_id FROM pool_members WHERE host_id = ?1')
			.all(hostId) as Array<Record<string, unknown>>
		return rows.map((row) => String(row.pool_id))
	}

	hostIdsInPool(poolIdOrName: string): string[] {
		const pool = this.getPool(poolIdOrName)
		if (!pool) {
			return []
		}
		const rows = this.db
			.query('SELECT host_id FROM pool_members WHERE pool_id = ?1')
			.all(pool.id) as Array<Record<string, unknown>>
		return rows.map((row) => String(row.host_id))
	}
}

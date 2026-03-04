import { Database } from 'bun:sqlite'
import { resolveDbPath } from '../config'
import { SCHEMA_STATEMENTS } from './schema'

export interface DbOptions {
	path?: string
}

export class HiveDb {
	readonly path: string
	readonly conn: Database

	constructor(options: DbOptions = {}) {
		this.path = resolveDbPath(options.path)
		this.conn = new Database(this.path)
		this.conn.exec('PRAGMA journal_mode = WAL;')
		this.conn.exec('PRAGMA foreign_keys = ON;')
		this.init()
	}

	init() {
		for (const statement of SCHEMA_STATEMENTS) {
			this.conn.exec(statement)
		}
	}

	close() {
		this.conn.close(false)
	}
}

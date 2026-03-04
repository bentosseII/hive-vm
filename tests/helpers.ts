import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface TempDb {
	dir: string
	dbPath: string
	cleanup: () => void
}

export const createTempDb = (): TempDb => {
	const dir = mkdtempSync(join(tmpdir(), 'hivevm-test-'))
	const dbPath = join(dir, 'hivevm.db')
	return {
		dir,
		dbPath,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	}
}

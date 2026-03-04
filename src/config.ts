import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const DEFAULT_STATE_DIR = '.hivevm'
export const DEFAULT_DB_NAME = 'hivevm.db'
export const DEFAULT_PLATFORM_TAKE_RATE = 0.25

export const defaultStateDir = () => resolve(process.cwd(), DEFAULT_STATE_DIR)

export const resolveDbPath = (dbPath?: string) => {
	if (dbPath?.trim()) {
		const absolute = resolve(dbPath)
		mkdirSync(dirname(absolute), { recursive: true })
		return absolute
	}
	const root = defaultStateDir()
	mkdirSync(root, { recursive: true })
	return resolve(root, DEFAULT_DB_NAME)
}

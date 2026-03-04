const UNITS_IN_MB: Record<string, number> = {
	mb: 1,
	gb: 1024,
	tb: 1024 * 1024,
}

const STORAGE_UNITS_IN_GB: Record<string, number> = {
	gb: 1,
	tb: 1024,
}

export const parseMemoryToMb = (value: string | number): number => {
	if (typeof value === 'number') {
		if (!Number.isFinite(value) || value <= 0) {
			throw new Error(`Invalid memory value: ${value}`)
		}
		return Math.floor(value)
	}

	const match = value
		.trim()
		.toLowerCase()
		.match(/^(\d+(?:\.\d+)?)(mb|gb|tb)$/)
	if (!match) {
		throw new Error(`Invalid memory string: ${value}`)
	}

	const amount = Number(match[1])
	const unit = match[2]
	return Math.floor(amount * UNITS_IN_MB[unit])
}

export const parseStorageToGb = (value: string | number): number => {
	if (typeof value === 'number') {
		if (!Number.isFinite(value) || value <= 0) {
			throw new Error(`Invalid storage value: ${value}`)
		}
		return Math.floor(value)
	}

	const match = value
		.trim()
		.toLowerCase()
		.match(/^(\d+(?:\.\d+)?)(gb|tb)$/)
	if (!match) {
		throw new Error(`Invalid storage string: ${value}`)
	}

	const amount = Number(match[1])
	const unit = match[2]
	return Math.floor(amount * STORAGE_UNITS_IN_GB[unit])
}

export const parseDurationToSeconds = (value: string): number => {
	const match = value
		.trim()
		.toLowerCase()
		.match(/^(\d+)(s|m|h|d)$/)
	if (!match) {
		throw new Error(`Invalid duration: ${value}`)
	}

	const amount = Number(match[1])
	const unit = match[2]
	const factors: Record<string, number> = {
		s: 1,
		m: 60,
		h: 3600,
		d: 86400,
	}
	return amount * factors[unit]
}

export const parseDateToUnix = (value: string): number => {
	const parsed = Date.parse(value)
	if (Number.isNaN(parsed)) {
		throw new Error(`Invalid date: ${value}`)
	}
	return Math.floor(parsed / 1000)
}

export const splitCsv = (value?: string | null): string[] => {
	if (!value?.trim()) {
		return []
	}
	return value
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean)
}

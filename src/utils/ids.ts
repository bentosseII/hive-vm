export const makeId = (prefix: string) =>
	`${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`

export const nowUnix = () => Math.floor(Date.now() / 1000)
export const minuteBucket = (unixSeconds: number) => Math.floor(unixSeconds / 60) * 60
export const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value))
export const daysToSeconds = (days: number) => Math.floor(days * 24 * 60 * 60)

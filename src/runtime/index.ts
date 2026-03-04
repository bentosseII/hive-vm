import { DockerRuntimeAdapter } from './dockerRuntime'
import { MockRuntimeAdapter } from './mockRuntime'
import type { RuntimeAdapter } from './types'

export const createRuntime = (kind: string | undefined): RuntimeAdapter => {
	if (kind === 'mock') {
		return new MockRuntimeAdapter()
	}
	return new DockerRuntimeAdapter()
}

export interface BuildSettings { signalingUrl: string; stunUrls: string[] }
export function buildSettings(env: Record<string, string | undefined>): BuildSettings;
export function validateStoreSettings(settings: BuildSettings): BuildSettings;

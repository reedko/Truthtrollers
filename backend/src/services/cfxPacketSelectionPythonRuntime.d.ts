export class CfxPythonRuntimeError extends Error {
  constructor(message: string);
}
export function resolveCfxPacketSelectionPythonExecutable(
  env?: NodeJS.ProcessEnv,
  options?: { localVenvExecutable?: string },
): Readonly<{ executable: string; source: "configured" | "local_venv" }>;
export function validateCfxPacketSelectionPythonRuntime(input?: {
  executable: string;
  cwd?: string;
  timeoutMs?: number;
}): Promise<Readonly<{ executable: string; pythonVersion: string }>>;

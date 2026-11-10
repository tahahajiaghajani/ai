// Node flags of the Windows app's backend (the Electron utility process that runs the local server and its sync).

/**
 * Does this Node read the operating system's certificate store with --use-system-ca? Node 22.15+ (22.x line) and
 * 23.8+ — then the app trusts the bank's CA installed on Windows by GPO (the server edition's certificate) with no
 * NODE_EXTRA_CA_CERTS file. Older Node: the documented NODE_EXTRA_CA_CERTS stays the way.
 */
export function supportsSystemCa(nodeVersion: string): boolean {
  const m = /^v?(\d+)\.(\d+)/.exec(nodeVersion);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return major >= 24 || (major === 23 && minor >= 8) || (major === 22 && minor >= 15);
}

/** execArgv of the backend utility process for this Node version. */
export const backendExecArgv = (nodeVersion: string): string[] => (supportsSystemCa(nodeVersion) ? ["--use-system-ca"] : []);

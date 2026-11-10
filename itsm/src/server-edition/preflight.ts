// The installer's preflight (karizctl preflight, run by install.ps1 right after the files are in place and before
// anything is changed): the machine's facts (gathered by install.ps1 with Windows' own tools and passed as flags) are
// checked against the server edition's needs, and the ports are chosen (ports.ts). The MSI checks what it can before
// it copies a file (launch conditions: administrator, x64, build, memory, a PowerShell execution policy set by Group
// Policy); this repeats those checks for a by-hand run of install.ps1 and adds what only a program can see (free disk on
// the data folder's drive, the ports, a pending restart). Messages are English and ASCII: they land in the MSI log,
// install-error.txt and the event log through Windows PowerShell 5.1. Pure: evaluatePreflight.
import { choosePorts, type PortChoice, type PortRequest } from "./ports";

export interface PreflightFacts {
  /** the current process is elevated (an administrator or SYSTEM) */
  admin?: boolean;
  /** PROCESSOR_ARCHITECTURE of the machine (AMD64, ARM64, x86) */
  arch?: string;
  /** Windows build (17763 = Windows Server 2019 / Windows 10 1809) */
  build?: number;
  /** 1 = a workstation (Windows 10/11), 2 = a domain controller, 3 = a server */
  productType?: number;
  memoryMb?: number;
  /** free space on the data folder's drive */
  freeDiskMb?: number;
  /** Windows has a restart pending (servicing, Windows Update, file renames) */
  pendingReboot?: boolean;
}

export const MIN_BUILD = 17763;
/** the MSI's own launch condition: PhysicalMemory >= 3800 */
export const MIN_MEMORY_MB = 3800;
export const MIN_DISK_MB = 2048;

export interface PreflightResult extends PortChoice {
  warnings: string[];
}

/** The checks of the machine (errors stop the install; warnings are logged) and the ports. */
export function evaluatePreflight(facts: PreflightFacts, ports: PortRequest, busy: (port: number) => string | null): PreflightResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (facts.admin === false) errors.push("run the installer as an administrator (right-click > Run as administrator, or an elevated command prompt)");
  if (facts.arch && !/^(amd64|x64)$/i.test(facts.arch)) errors.push(`this computer is ${facts.arch}: the server edition needs 64-bit Windows on an x64 (Intel or AMD) processor`);
  if (facts.build !== undefined && facts.build > 0 && facts.build < MIN_BUILD) errors.push(`Windows build ${facts.build} is too old: Windows Server 2019 / Windows 10 version 1809 (build ${MIN_BUILD}) or later is needed`);
  if (facts.memoryMb !== undefined && facts.memoryMb > 0) {
    if (facts.memoryMb < MIN_MEMORY_MB) errors.push(`${Math.round(facts.memoryMb / 1024)} GB of memory: at least 4 GB is needed (16 GB recommended for a bank)`);
    else if (facts.memoryMb < 7.5 * 1024) warnings.push("less than 8 GB of memory: fine for a lab or a demo, too small for a bank (16 GB or more recommended)");
  }
  if (facts.freeDiskMb !== undefined && facts.freeDiskMb >= 0) {
    if (facts.freeDiskMb < MIN_DISK_MB) errors.push(`only ${(facts.freeDiskMb / 1024).toFixed(1)} GB free on the data folder's drive: at least 2 GB is needed (choose another drive with DATADIR=)`);
    else if (facts.freeDiskMb < 20 * 1024) warnings.push(`only ${(facts.freeDiskMb / 1024).toFixed(1)} GB free on the data folder's drive: plan for the database, attachments and backups`);
  }
  if (facts.pendingReboot) warnings.push("Windows has a restart pending: if the install or the services fail, restart Windows and run the installer again");
  if (facts.productType === 1) warnings.push("Windows 10/11 (a workstation): lab or demo mode; use Windows Server for production");
  const choice = choosePorts(ports, busy);
  return { ...choice, ok: errors.length === 0 && choice.ok, errors: [...errors, ...choice.errors], warnings };
}

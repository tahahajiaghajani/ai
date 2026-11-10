// The local inventory collector (catalogue CMDB-048/051 — the Windows app as a collector, no inbound ports): the
// desktop's local server reads its own computer — host and domain names, operating system, processor, memory, network
// address, and on Windows the BIOS serial, maker, model, chassis and disks through PowerShell/CIM, plus optionally the
// installed programs from the registry — and reports it through the reconciliation engine as source «جمع‌آورندهٔ <نام>»
// (one CI of class desktop, laptop or server; installed programs as software CIs that «اجرا روی» it). Fixed commands
// only, each with a time limit; nothing a person types reaches a shell. Only the Windows app (`cfg.mode = desktop`).
import os from "node:os";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { IreItem, IreResult, LocalInventory } from "@shared/cmdb/api";
import type { Ctx } from "../../context";
import { forbidden } from "../../http/errors";
import { createIn, updateIn } from "../../engine";
import { eqAll, liveRows, sysOf, type Row } from "./common";
import { createOrUpdate } from "./ire";

const TIMEOUT = 15_000;
const MAX_SOFTWARE = 300;

function run(cmd: string, args: string[], timeout = TIMEOUT): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? "" : String(stdout ?? "")));
  });
}

const ps = (script: string) => run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]);

const LAPTOP_CHASSIS = new Set([8, 9, 10, 11, 12, 14, 18, 21, 30, 31, 32]);

/** The first non-internal IPv4 address with its MAC (the address the machine is most likely reached at). */
function primaryNic(): { ip: string | null; mac: string | null } {
  const nics = os.networkInterfaces();
  for (const list of Object.values(nics)) {
    for (const n of list ?? []) {
      if (n.internal || n.family !== "IPv4" || n.address.startsWith("169.254.")) continue;
      return { ip: n.address, mac: n.mac && n.mac !== "00:00:00:00:00:00" ? n.mac : null };
    }
  }
  return { ip: null, mac: null };
}

async function linuxDmi(field: string): Promise<string | null> {
  try {
    const v = (await readFile(`/sys/class/dmi/id/${field}`, "utf8")).trim();
    return v || null;
  } catch {
    return null;
  }
}

/** Read the computer this server runs on. */
export async function collectLocalInventory(opts: { software?: boolean } = {}): Promise<LocalInventory & { chassis: number[]; server: boolean }> {
  const warnings: string[] = [];
  const cpus = os.cpus();
  const nic = primaryNic();
  const hostname = os.hostname();
  const inv: LocalInventory & { chassis: number[]; server: boolean } = {
    hostname,
    fqdn: null,
    platform: process.platform,
    os: os.type(),
    os_version: os.release(),
    arch: os.arch(),
    cpu_model: cpus[0]?.model?.trim() ?? null,
    cpu_count: cpus.length,
    ram_mb: Math.round(os.totalmem() / 1024 / 1024),
    ip_address: nic.ip,
    mac_address: nic.mac,
    serial_number: null,
    manufacturer: null,
    model_name: null,
    bios_uuid: null,
    domain: null,
    user: (() => {
      try {
        return os.userInfo().username;
      } catch {
        return null;
      }
    })(),
    disk_gb: null,
    software: [],
    collected_at: new Date().toISOString(),
    warnings,
    chassis: [],
    server: false,
  };
  if (process.platform === "win32") {
    const script = [
      "$ErrorActionPreference='SilentlyContinue'",
      "$b=Get-CimInstance Win32_BIOS; $c=Get-CimInstance Win32_ComputerSystem; $o=Get-CimInstance Win32_OperatingSystem; $p=Get-CimInstance Win32_ComputerSystemProduct; $e=Get-CimInstance Win32_SystemEnclosure",
      "$d=(Get-CimInstance Win32_DiskDrive | Measure-Object -Property Size -Sum).Sum",
      "[pscustomobject]@{serial=$b.SerialNumber; maker=$c.Manufacturer; model=$c.Model; domain=$c.Domain; part=$c.PartOfDomain; os=$o.Caption; ver=$o.Version; type=$o.ProductType; uuid=$p.UUID; chassis=@($e.ChassisTypes); disk=$d} | ConvertTo-Json -Compress",
    ].join("; ");
    const raw = await ps(script);
    try {
      const j = JSON.parse(raw || "{}");
      inv.serial_number = j.serial ? String(j.serial).trim() : null;
      inv.manufacturer = j.maker ? String(j.maker).trim() : null;
      inv.model_name = j.model ? String(j.model).trim() : null;
      inv.os = j.os ? String(j.os).trim() : inv.os;
      inv.os_version = j.ver ? String(j.ver) : inv.os_version;
      inv.bios_uuid = j.uuid && !/^0{8}-/.test(String(j.uuid)) ? String(j.uuid).toUpperCase() : null;
      inv.domain = j.part && j.domain ? String(j.domain).toLowerCase() : null;
      inv.chassis = Array.isArray(j.chassis) ? j.chassis.map(Number) : j.chassis ? [Number(j.chassis)] : [];
      inv.server = Number(j.type) === 2 || Number(j.type) === 3;
      inv.disk_gb = j.disk ? Math.round(Number(j.disk) / 1e9) : null;
    } catch {
      warnings.push("اطلاعات سخت‌افزار از ویندوز خوانده نشد (PowerShell در دسترس نبود)");
    }
    if (opts.software) {
      const sw = await ps(
        "$ErrorActionPreference='SilentlyContinue'; Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | Where-Object { $_.DisplayName -and -not $_.SystemComponent } | Select-Object DisplayName, DisplayVersion, Publisher | ConvertTo-Json -Compress",
      );
      try {
        const list = JSON.parse(sw || "[]");
        const arr = Array.isArray(list) ? list : [list];
        const seen = new Set<string>();
        for (const s of arr) {
          const name = String(s?.DisplayName ?? "").trim();
          if (!name || seen.has(name.toLowerCase())) continue;
          seen.add(name.toLowerCase());
          inv.software.push({ name: name.slice(0, 200), version: s.DisplayVersion ? String(s.DisplayVersion).slice(0, 80) : null, vendor: s.Publisher ? String(s.Publisher).slice(0, 120) : null });
          if (inv.software.length >= MAX_SOFTWARE) break;
        }
      } catch {
        warnings.push("فهرست نرم‌افزارهای نصب‌شده خوانده نشد");
      }
    }
  } else if (process.platform === "linux") {
    inv.serial_number = await linuxDmi("product_serial");
    inv.manufacturer = await linuxDmi("sys_vendor");
    inv.model_name = await linuxDmi("product_name");
    inv.bios_uuid = (await linuxDmi("product_uuid"))?.toUpperCase() ?? null;
    const chassis = Number(await linuxDmi("chassis_type"));
    inv.chassis = Number.isFinite(chassis) && chassis > 0 ? [chassis] : [];
    try {
      const rel = await readFile("/etc/os-release", "utf8");
      const name = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(rel)?.[1];
      if (name) inv.os = name;
    } catch {
      // keep os.type()
    }
    if (!inv.serial_number) warnings.push("شمارهٔ سریال خوانده نشد (دسترسی به /sys/class/dmi لازم است)");
  } else if (process.platform === "darwin") {
    const raw = await run("system_profiler", ["SPHardwareDataType", "-json"]);
    try {
      const h = JSON.parse(raw || "{}").SPHardwareDataType?.[0] ?? {};
      inv.serial_number = h.serial_number ?? null;
      inv.manufacturer = "Apple";
      inv.model_name = h.machine_model ?? h.machine_name ?? null;
      inv.bios_uuid = h.platform_UUID ?? null;
      inv.chassis = /book/i.test(String(h.machine_name ?? "")) ? [10] : [3];
    } catch {
      warnings.push("اطلاعات سخت‌افزار خوانده نشد");
    }
  }
  inv.fqdn = inv.domain ? `${hostname}.${inv.domain}`.toLowerCase() : null;
  return inv;
}

/** The class of the machine: server operating systems → server, portable chassis → laptop, else desktop. */
export function machineClass(inv: { server: boolean; chassis: number[]; os: string }): string {
  if (inv.server || /server/i.test(inv.os)) return "server";
  if (inv.chassis.some((c) => LAPTOP_CHASSIS.has(c))) return "laptop";
  return "desktop";
}

/** The reconciliation items of an inventory: the computer, and its installed programs running on it. */
export function inventoryItems(inv: LocalInventory & { chassis: number[]; server: boolean }, opts: { software?: boolean } = {}): IreItem[] {
  const computer: IreItem = {
    class: machineClass(inv),
    values: {
      name: inv.hostname, hostname: inv.hostname.toLowerCase(), fqdn: inv.fqdn, ip_address: inv.ip_address, mac_address: inv.mac_address,
      serial_number: inv.serial_number, manufacturer: inv.manufacturer, model_name: inv.model_name, bios_uuid: inv.bios_uuid,
      os: inv.os, os_version: inv.os_version, cpu_count: inv.cpu_count, ram_mb: inv.ram_mb, disk_gb: inv.disk_gb, install_status: "installed",
    },
    attrs: { cpu_model: inv.cpu_model, domain: inv.domain, last_logged_user: inv.user },
  };
  for (const k of Object.keys(computer.values)) if (computer.values[k] === null || computer.values[k] === undefined) delete computer.values[k];
  for (const k of Object.keys(computer.attrs!)) if (computer.attrs![k] === null || computer.attrs![k] === undefined) delete computer.attrs![k];
  const items: IreItem[] = [computer];
  if (opts.software) {
    for (const s of inv.software.slice(0, MAX_SOFTWARE)) {
      items.push({ class: "application", values: { name: s.name, sw_version: s.version ?? undefined, install_status: "installed" }, attrs: s.vendor ? { vendor: s.vendor } : {}, relations: [{ type: "runs_on", direction: "out", item: 0 }] });
    }
  }
  return items;
}

/** This machine's collector record and data source (created on first use). */
async function ensureCollector(ctx: Ctx, inv: LocalInventory, opts: { software?: boolean }): Promise<{ collector: Row; source: Row }> {
  return ctx.write(async (tx) => {
    const sys = sysOf(ctx);
    const machine = (inv.bios_uuid || `${inv.hostname}:${inv.mac_address ?? ""}`).slice(0, 120);
    let [collector] = await liveRows(tx, sys, "discovery_collector", eqAll({ machine_id: machine }), { limit: 1 });
    let source = collector?.source_id ? (await liveRows(tx, sys, "cmdb_data_source", { f: "id", op: "eq", v: collector.source_id }, { limit: 1 }))[0] : undefined;
    if (!source) {
      const name = `جمع‌آورندهٔ ${inv.hostname}`.slice(0, 120);
      [source] = await liveRows(tx, sys, "cmdb_data_source", eqAll({ name }), { limit: 1 });
      if (!source) source = await createIn(tx, sys, "cmdb_data_source", { name, kind: "collector", priority: 30, stale_after_days: 30, delete_policy: "flag", owner_id: ctx.actor === "system" ? null : ctx.user.id, description: "موجودی رایانه‌ای که نسخهٔ ویندوزی روی آن اجرا می‌شود" }, { trusted: true });
    }
    if (!collector) {
      collector = await createIn(tx, sys, "discovery_collector", {
        name: `رایانهٔ ${inv.hostname}`.slice(0, 120), kind: "desktop", machine_id: machine, hostname: inv.hostname, platform: `${inv.os} ${inv.os_version}`.slice(0, 120),
        source_id: source.id, include_software: !!opts.software, every_hours: 24,
      }, { trusted: true });
    }
    return { collector, source };
  });
}

/** Collect this machine's inventory and reconcile it (the Windows app only). */
export async function runLocalCollector(ctx: Ctx, opts: { software?: boolean; dryRun?: boolean; inventory?: LocalInventory & { chassis: number[]; server: boolean } } = {}): Promise<{ inventory: LocalInventory; result: IreResult; collector_id: string }> {
  if (ctx.cfg.mode !== "desktop" && !opts.inventory) throw forbidden("جمع‌آوری موجودی این رایانه فقط در نسخهٔ ویندوزی است");
  const inv = opts.inventory ?? (await collectLocalInventory({ software: opts.software }));
  const { collector, source } = await ensureCollector(ctx, inv, opts);
  const software = opts.software ?? !!collector.include_software;
  const result = await createOrUpdate(ctx, { source_id: source.id, items: inventoryItems(inv, { software }), dry_run: opts.dryRun });
  if (!opts.dryRun) {
    const ciId = result.results[0]?.ci_id ?? collector.ci_id ?? null;
    await ctx.write((tx) =>
      updateIn(tx, sysOf(ctx), "discovery_collector", collector.id, {
        last_heartbeat: new Date().toISOString(), last_run_at: new Date().toISOString(), ci_id: ciId, agent_version: process.versions.node,
        last_result: `${result.created} ساخته، ${result.updated} به‌روز، ${result.unchanged} بدون تغییر${result.failed ? `، ${result.failed} ناموفق` : ""}`.slice(0, 300),
      }, { trusted: true, keepVersion: true }),
    );
  }
  return { inventory: inv, result, collector_id: collector.id };
}

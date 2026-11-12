// The demo pack's connector (design A §14.4): fixed records with status flips on a timer and no network call. Its jobs
// are demo work and its items, runs and states demo rows. DA5 replaces the fixture below with the pack's own servers,
// branches and ATMs (connectors/demo-data.ts); the shape and the timer stay.
import { z } from "zod";
import { demo as descriptor } from "@shared/discovery/kinds/demo";
import type { Cursor, DiscoveredRecord, Page } from "@shared/discovery/types";
import type { ConnCtx, ConnectorKind } from "../kind";

/** A small fleet: core servers, a virtualisation host with a VM, a branch switch and two ATMs. */
export const DEMO_FIXTURE: DiscoveredRecord[] = [
  { external_id: "demo-srv-01", kind: "host", class: "server", name: "srv-core-01", hostname: "srv-core-01", domain: "aftab-bank.example", ips: ["10.10.0.11"], serial_number: "DEMO-SRV-0001", manufacturer: "HPE", model: "ProLiant DL380", os: "Windows Server 2022" },
  { external_id: "demo-srv-02", kind: "host", class: "server", name: "srv-core-02", hostname: "srv-core-02", domain: "aftab-bank.example", ips: ["10.10.0.12"], serial_number: "DEMO-SRV-0002", manufacturer: "HPE", model: "ProLiant DL380", os: "Red Hat Enterprise Linux 9" },
  { external_id: "demo-esx-01", kind: "host", class: "server", name: "esx-01", hostname: "esx-01", domain: "aftab-bank.example", ips: ["10.10.1.21"], serial_number: "DEMO-ESX-0001", manufacturer: "Dell", model: "PowerEdge R750" },
  { external_id: "demo-vm-01", kind: "vm", class: "virtual_machine", name: "vm-app-01", hostname: "vm-app-01", domain: "aftab-bank.example", ips: ["10.10.2.31"], parent_external_id: "demo-esx-01", os: "Ubuntu 24.04" },
  { external_id: "demo-sw-101", kind: "network", class: "switch", name: "sw-branch-101", hostname: "sw-branch-101", ips: ["10.20.101.1"], serial_number: "DEMO-SW-0101", manufacturer: "Cisco", model: "C9200" },
  { external_id: "demo-atm-1021", kind: "atm", name: "ATM-1021", terminal_id: "1021" },
  { external_id: "demo-atm-1022", kind: "atm", name: "ATM-1022", terminal_id: "1022" },
];

const options = z.object({ flip_minutes: z.coerce.number().int().min(1).max(1440).default(10) });

/** The fleet at `now`: every machine in contact; one server and one ATM take turns being down. */
export function demoRecords(now: Date, flipMinutes: number): DiscoveredRecord[] {
  const turn = Math.floor(now.getTime() / (flipMinutes * 60_000));
  return DEMO_FIXTURE.map((r) => {
    const down = (r.external_id === "demo-srv-02" && turn % 2 === 1) || (r.external_id === "demo-atm-1022" && turn % 3 === 2);
    return {
      ...r,
      last_contact_at: now.toISOString(),
      status: down
        ? { state: "down" as const, availability: true, message: "پاسخی به ping نمی‌دهد", ...(r.kind === "atm" ? { device_status: "OFFLINE" } : {}) }
        : { state: "up" as const, ...(r.kind === "atm" ? { device_status: "IN_SERVICE" } : {}) },
    };
  });
}

export const connector: ConnectorKind = {
  ...descriptor,
  headers: [],
  optionsSchema: options,
  async test() {
    return { ok: true, version: "demo", identity: "منبع نمایشی", warnings: [] };
  },
  async pages(c: ConnCtx, _cursor: Cursor | null): Promise<Page> {
    void _cursor;
    const records = demoRecords(c.now(), Number((c.options as { flip_minutes?: number }).flip_minutes ?? 10));
    return { records, next: null, complete: true, total: records.length };
  },
};

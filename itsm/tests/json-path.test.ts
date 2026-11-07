// The path reader of JSON answers a person points at (which field of an outside service's answer or of an incoming
// webhook to read): keys, array positions in both spellings and in Persian digits, and an array item picked by a field
// (monitoring and inventory APIs answer with lists such as [{host: "sw-02", cpu: …}]).
import { describe, it, expect } from "vitest";
import { pickPath } from "@shared/json-path";

const answer = {
  data: { alert: { title: "CPU above 90%" } },
  items: [
    { host: "sw-02", name: "سوئیچ طبقهٔ دوم", cpu: 91, status: "critical" },
    { host: "fw-01", name: "دیوار آتش", cpu: 34 },
  ],
  sites: { tehran: { devices: "128" } },
  rows: { a: { key: "disk", p: 1 }, b: { key: "memory", p: 2 } },
};

describe("pickPath", () => {
  it("reads keys and array positions", () => {
    expect(pickPath(answer, "data.alert.title")).toBe("CPU above 90%");
    expect(pickPath(answer, "items[1].cpu")).toBe(34);
    expect(pickPath(answer, "items.1.cpu")).toBe(34);
    expect(pickPath(answer, "sites.tehran.devices")).toBe("128");
    // positions typed the way the app shows digits
    expect(pickPath(answer, "items[۱].cpu")).toBe(34);
    expect(pickPath(answer, "items.۱.cpu")).toBe(34);
    expect(pickPath(answer, "items[١].cpu")).toBe(34);
  });

  it("picks an array item by a field", () => {
    expect(pickPath(answer, "items[host=sw-02].status")).toBe("critical");
    expect(pickPath(answer, 'items[host="fw-01"].cpu')).toBe(34);
    expect(pickPath(answer, "items[ host = 'sw-02' ].cpu")).toBe(91);
    expect(pickPath(answer, "items[name=سوئیچ طبقهٔ دوم].cpu")).toBe(91);
    // the values of an object work like a list too
    expect(pickPath(answer, "rows[key=memory].p")).toBe(2);
  });

  it("gives undefined, never throws, for what is not there", () => {
    expect(pickPath(answer, "items[host=db-09].cpu")).toBeUndefined();
    expect(pickPath(answer, "items[9].cpu")).toBeUndefined();
    expect(pickPath(answer, "items.cpu")).toBeUndefined();
    expect(pickPath(answer, "data.alert.title.x")).toBeUndefined();
    expect(pickPath(null, "a.b")).toBeUndefined();
    expect(pickPath(answer, "")).toBe(answer);
  });
});

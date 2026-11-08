// The modules' screens side by side: every route path and nav path is unique (the request module's «اشتراک‌های
// خدمت» at `subscriptions`, the portfolio's notice subscriptions at `service-subscriptions`, with distinct labels), the
// CMDB's CI picker is the picker of every reference to a CI, knowledge management's deflection is the order form's
// assist, and the confirmation after an order names what it opens («دیدن رخداد» after «گزارش مشکل»).
import { describe, expect, it } from "vitest";
import { NAV, ROUTES, SPACE_OF_SEGMENT } from "../src/ui/modules/registry";
import { refPickerFor } from "../src/ui/records/extensions";
import { orderAssist, typedText } from "../src/ui/modules/request/slots";
import { orderDoneLabel } from "../src/ui/modules/request/model";

describe("the modules' screens together", () => {
  it("route paths and nav paths do not collide", () => {
    const paths = ROUTES.map((r) => r.path);
    const dupes = paths.filter((p, i) => paths.indexOf(p) !== i);
    expect(dupes).toEqual([]);
    const items = NAV.flatMap((g) => g.items);
    const navPaths = items.map((i) => i.path);
    expect(navPaths.filter((p, i) => navPaths.indexOf(p) !== i)).toEqual([]);
    const sub = items.find((i) => i.path === "subscriptions");
    const notices = items.find((i) => i.path === "service-subscriptions");
    expect(sub && notices).toBeTruthy();
    expect(sub!.label).not.toBe(notices!.label);
    expect(SPACE_OF_SEGMENT.subscriptions).toBe("service");
    expect(SPACE_OF_SEGMENT["service-subscriptions"]).toBe("portfolio");
  });

  it("references to CIs use the CMDB's picker; the order form gets knowledge's deflection", () => {
    expect(typeof refPickerFor("ci")).toBe("function");
    expect(refPickerFor("service")).toBeUndefined();
    expect(typeof orderAssist()).toBe("function");
    expect(typedText({ subject: "VPN وصل نمی‌شود", details: "از دیروز عصر اتصال قطع می‌شود", for: "01a1ba1a-6c55-7032-8ff5-c64d41aa398d", end: "2030-01-01", n: 3 })).toBe("VPN وصل نمی‌شود از دیروز عصر اتصال قطع می‌شود");
  });

  it("the confirmation after an order names what it opens", () => {
    expect(orderDoneLabel({ table: "request" }, "درخواست")).toBe("دیدن سفارش");
    expect(orderDoneLabel({ table: "incident" }, "رخداد")).toBe("دیدن رخداد");
    expect(orderDoneLabel({ table: "todo" }, null)).toBe("دیدن رکورد");
    expect(orderDoneLabel(null)).toBe("باشه");
  });
});

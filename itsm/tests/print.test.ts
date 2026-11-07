// Printing: the paper a sheet asks of the Windows app (Electron's print takes it from the call, not from CSS),
// so a wide report on A4 landscape or a slip on an 80 mm roll comes out of the printer as it was laid out.
import { describe, it, expect } from "vitest";
import { electronPage } from "../src/ui/lib/print";

describe("electronPage", () => {
  it("maps named papers and their orientation", () => {
    expect(electronPage("A5 portrait")).toEqual({ pageSize: "A5", landscape: false });
    expect(electronPage("A4 landscape")).toEqual({ pageSize: "A4", landscape: true });
    expect(electronPage("a4")).toEqual({ pageSize: "A4", landscape: false });
    expect(electronPage("letter landscape")).toEqual({ pageSize: "Letter", landscape: true });
  });

  it("passes a custom paper (a receipt roll, labels) in microns", () => {
    expect(electronPage("80mm 123mm")).toEqual({ pageSize: { width: 80000, height: 123000 }, landscape: false });
    expect(electronPage("50mm 30mm")).toEqual({ pageSize: { width: 50000, height: 30000 }, landscape: false });
    expect(electronPage("62.5mm")).toEqual({ pageSize: { width: 62500, height: 62500 }, landscape: false });
  });

  it("falls back to A4 for a size it cannot read", () => {
    expect(electronPage("auto")).toEqual({ pageSize: "A4", landscape: false });
    expect(electronPage("landscape")).toEqual({ pageSize: "A4", landscape: true });
  });
});

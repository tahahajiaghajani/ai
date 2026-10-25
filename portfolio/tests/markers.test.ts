import { describe, expect, it } from "vitest";
import { parseMarkers } from "@/lib/markers";

describe("parseMarkers", () => {
  it("removes markers and returns actions once each", () => {
    const r = parseMarkers("Taha built it.\n[[work:turbine-vision]] [[action:ticket]] [[action:ticket]]");
    expect(r.text).toBe("Taha built it.");
    expect(r.actions).toEqual([{ kind: "work", slug: "turbine-vision" }, { kind: "ticket" }]);
    expect(r.unknown).toBe(false);
  });
  it("flags unknown answers", () => {
    expect(parseMarkers("I don't know.\n[[unknown]] [[action:contact]]")).toMatchObject({ unknown: true, actions: [{ kind: "contact" }] });
  });
  it("hides a marker that is still streaming in", () => {
    expect(parseMarkers("Answer [[act").text).toBe("Answer");
  });
});

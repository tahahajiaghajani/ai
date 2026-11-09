// `{{block.release_readiness}}` in notification templates of releases: the readiness of the release for one recipient
// — the readiness percent, the decision, the risk and the blocking checks still open — read with the recipient's
// access (no access to the results → nothing). It lets the seeded «انتشار به مرحلهٔ تصمیم اجرا رسید» or an
// organisation's own rule carry what the decision waits for. No model is called while messages go out.
import { escapeMarkdown, plainLine } from "@shared/notify";
import { readinessOf } from "@shared/release/logic";
import { list } from "../../engine";
import { registerTemplateBlock } from "../notify";
import { decisionLabel, riskLabelOf } from "./labels";

export function installReleaseBlocks(): (() => void)[] {
  return [
    registerTemplateBlock("release_readiness", {
      label: "آمادگی انتشار",
      description: "درصد آمادگی، تصمیم اجرا، ریسک و بررسی‌های بازدارندهٔ باز انتشار (با دسترسی گیرنده)",
      tables: ["release"],
      fields: ["go_no_go", "risk_band", "readiness_pct"],
      async render({ ctx, id, row, link }) {
        const r = await list(ctx, "release_check_result", { filter: { f: "release_id", op: "eq", v: id }, fields: ["name", "status", "blocking"], size: 200, total: false }).catch(() => null);
        if (!r) return null;
        const rd = readinessOf(r.rows as never);
        const head = `آمادگی ${rd.pct.toLocaleString("fa-IR")}٪ — تصمیم: ${decisionLabel(row.go_no_go)}${row.risk_band ? ` — ریسک: ${riskLabelOf(row.risk_band)}` : ""}`;
        const blockers = rd.blockers.slice(0, 8).map((b) => `- ${escapeMarkdown(plainLine(b, 160))}`);
        return {
          markdown: [escapeMarkdown(head), ...(blockers.length ? ["", "بررسی‌های بازدارندهٔ باز:", ...blockers] : []), "", `[دیدن انتشار](${link(`releases/${id}`)})`].join("\n"),
          text: `${head}${rd.blockers.length ? ` — ${rd.blockers.length.toLocaleString("fa-IR")} مانع` : ""}`,
        };
      },
    }),
  ];
}

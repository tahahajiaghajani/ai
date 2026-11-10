// «بایگانی» in the organisation's settings: closed records nobody touched for N years leave the work tables for their
// archive at night (src/server/engine/archive.ts) — still readable and searchable, out of the queues' way.
import { Button, Form, Select, Switch } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { formatNumber } from "@shared/format";

interface ArchiveSummary {
  settings: { enabled: boolean; years: number };
  tables: { key: string; label: string; archived: number; capped: boolean }[];
}

const YEARS = [1, 2, 3, 4, 5, 7, 10].map((y) => ({ value: y, label: `${formatNumber(y)} سال` }));

export function ArchiveSettings({ section }: { section: (title: string, desc: string | null, body: React.ReactNode) => React.ReactNode }) {
  const { api, can } = useOrg();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["archive"], queryFn: () => api.get<ArchiveSummary>("/archive") });
  const full = can("settings", "full");
  const save = useAction((v: { enabled: boolean; years: number }) => api.put<ArchiveSummary>("/archive", v), {
    success: "تنظیم بایگانی ذخیره شد.",
    onSuccess: (d) => qc.setQueryData(["archive"], d),
  });
  const run = useAction(() => api.post("/archive/run", {}), { success: "بایگانی در صف اجرا قرار گرفت." });
  if (!q.data) return null;
  const s = q.data.settings;
  return (
    <Form layout="vertical" requiredMark={false} disabled={!full} initialValues={s} onFinish={(v) => save.mutate(v)} className="blk-card">
      <div className="px-5">
        {section(
          "بایگانی رکوردهای بسته",
          "رکوردهای بسته‌ای که چند سال دست نخورده‌اند، شب‌ها به بایگانی می‌روند و همچنان خواندنی و جست‌وجوپذیرند.",
          <div className="blk-grid3">
            <Form.Item name="enabled" label="بایگانی خودکار" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="years" label="پس از">
              <Select options={YEARS} />
            </Form.Item>
          </div>,
        )}
        {section(
          "در بایگانی",
          null,
          <ul className="flex flex-col gap-1">
            {q.data.tables.map((t) => (
              <li key={t.key} className="flex justify-between gap-4">
                <span>{t.label}</span>
                <span className="ds-num">{t.capped ? `بیش از ${formatNumber(t.archived)}` : formatNumber(t.archived)}</span>
              </li>
            ))}
          </ul>,
        )}
      </div>
      {full ? (
        <div className="blk-savebar">
          <Button onClick={() => run.mutate(undefined as never)} loading={run.isPending} disabled={!s.enabled}>
            اجرا اکنون
          </Button>
          <Button type="primary" htmlType="submit" loading={save.isPending}>
            ذخیره
          </Button>
        </div>
      ) : null}
    </Form>
  );
}

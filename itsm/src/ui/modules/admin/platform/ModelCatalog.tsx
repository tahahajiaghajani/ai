// «کاتالوگ مدل‌ها» on the platform owner's AI page: the AI services the platform offers organisations (the presets) —
// region, the runtimes they work in, the default model per job tier (smart / fast / vision), the suggested models and
// the embedding models of retrieval. Read-only: organisations connect their own keys in their AI settings.
import { Table } from "antd";
import { Chip } from "../../../components/display";
import { Card } from "../../../components/blocks";
import { useAdminQuery } from "../../../pages/admin/ui";

interface Provider {
  id: string;
  label: string;
  protocol: string;
  region: string | null;
  runtimes: string[] | null;
  models: { smart: string[]; fast: string[]; vision: string[] };
  suggested: string[];
  embed: { models: string[] } | null;
  badge: string | null;
}

const REGION: Record<string, string> = { foreign: "خارج از ایران", iran: "ایران", local: "همین رایانه یا شبکه", any: "هر جا" };

const Mono = ({ v }: { v: string[] | undefined }) => (v?.length ? <span className="ltr ds-mono text-[12px]">{v.join("، ")}</span> : <span className="text-ink-3">—</span>);

export default function ModelCatalog() {
  const q = useAdminQuery<{ providers: Provider[] }>(["console", "models"], "/admin/models");
  return (
    <Card title="کاتالوگ مدل‌ها" flush>
      <Table
        size="small"
        rowKey="id"
        loading={q.isLoading}
        dataSource={q.data?.providers ?? []}
        pagination={false}
        scroll={{ x: true }}
        columns={[
          { title: "سرویس", dataIndex: "label", render: (v: string, p) => <span className="flex items-center gap-2">{v}{p.badge ? <Chip tone="neutral">{p.badge}</Chip> : null}</span> },
          { title: "منطقه", dataIndex: "region", render: (v: string | null) => (v ? (REGION[v] ?? v) : "—") },
          { title: "اجرا", dataIndex: "runtimes", render: (v: string[] | null) => (v?.length ? v.map((r) => (r === "desktop" ? "ویندوز" : r === "web" ? "وب" : r)).join("، ") : "همه") },
          { title: "هوشمند", render: (_: unknown, p: Provider) => <Mono v={p.models.smart.slice(0, 1)} /> },
          { title: "سریع", render: (_: unknown, p: Provider) => <Mono v={p.models.fast.slice(0, 1)} /> },
          { title: "تصویر", render: (_: unknown, p: Provider) => <Mono v={p.models.vision.slice(0, 1)} /> },
          { title: "بردارسازی", render: (_: unknown, p: Provider) => <Mono v={p.embed?.models.slice(0, 1)} /> },
          { title: "پیشنهادی", dataIndex: "suggested", render: (v: string[]) => <Mono v={v} /> },
        ]}
      />
    </Card>
  );
}

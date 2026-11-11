// «مقالهٔ تازه» (kb/new): the base the author writes in (only those they contribute to), its category, the kind of
// article — the type picks the base's template (KCS: issue, environment, resolution, cause; how-to: steps; FAQ;
// policy…), whose sections become the first draft — the title, language and whether it is for agents only. Creating
// opens the editor on the first draft. `?title=` starts from a search that found nothing.
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button, Input, Radio, Select, TreeSelect } from "antd";
import { FilePlus2 } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Card, Field } from "../../components/blocks";
import { EmptyState, Loader } from "../../components/display";
import { kbApi, useKbHome, useKbMeta } from "./api";
import { categoryTree, LANGUAGES, type CategoryTree } from "./model";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

interface TreeNode {
  value: string;
  title: string;
  children: TreeNode[];
}
const treeData = (nodes: CategoryTree[]): TreeNode[] => nodes.map((n) => ({ value: n.id, title: n.name, children: treeData(n.children) }));

export default function NewArticle() {
  const { api, orgId, allows } = useOrg();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const home = useKbHome();
  const meta = useKbMeta();
  const bases = useMemo(() => (home.data?.bases ?? []).filter((b) => b.contribute), [home.data]);
  const [base, setBase] = useState<string | null>(sp.get("base"));
  const [category, setCategory] = useState<string | null>(null);
  const [type, setType] = useState<string>("how_to");
  const [title, setTitle] = useState(sp.get("title") ?? "");
  const [language, setLanguage] = useState("fa");
  const [visibility, setVisibility] = useState<"inherit" | "internal">("inherit");
  const baseId = base ?? bases[0]?.id ?? null;
  const tree = useMemo(() => (baseId ? categoryTree(home.data?.categories ?? [], baseId) : []), [home.data, baseId]);
  const create = useAction(
    () => kbApi.create(api, { base_id: baseId!, category_id: category, article_type: type, title: title.trim(), language, visibility }),
    { onSuccess: (d) => nav(`/${orgId}/kb/edit/${d.version.id}`, { replace: true }) },
  );
  if (home.isLoading || meta.isLoading) return <Loader />;
  if (!bases.length)
    return (
      <div>
        <PageHeader title="مقالهٔ تازه" back={`/${orgId}/kb`} />
        {!home.data?.bases?.length && allows({ area: "knowledge", op: "admin" }) ? (
          // a new organisation: its default bases are made a few minutes after it (the knowledge seed job)
          <EmptyState
            icon={FilePlus2}
            title="هنوز پایگاه دانشی ساخته نشده است"
            description="پایگاه‌های پیش‌فرض چند دقیقه پس از ساخت سازمان آماده می‌شوند؛ می‌توانید همین حالا یک پایگاه بسازید."
            action={
              <Button type="primary" onClick={() => nav(`/${orgId}/kb/bases/new`)}>
                پایگاه دانش تازه
              </Button>
            }
          />
        ) : (
          <EmptyState icon={FilePlus2} title="پایگاهی نیست که در آن بنویسید" description="از مدیر دانش بخواهید شما را به مشارکت‌کنندگان یک پایگاه بیفزاید." />
        )}
      </div>
    );
  const types = (meta.data?.types ?? []).map((t) => ({ value: t.value, label: t.label }));
  const internalBase = bases.find((b) => b.id === baseId)?.kind === "internal";
  return (
    <div>
      <PageHeader title="مقالهٔ تازه" back={`/${orgId}/kb`} />
      <Card className="max-w-2xl">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (baseId && title.trim()) create.mutate();
          }}
        >
          <Field label="پایگاه دانش" htmlFor="kb-new-base">
            <Select id="kb-new-base" className="w-full" value={baseId ?? undefined} onChange={(v) => (setBase(v), setCategory(null))} options={bases.map((b) => ({ value: b.id, label: `${b.name}${b.kind === "internal" ? " (فقط کارشناسان)" : ""}` }))} />
          </Field>
          {tree.length ? (
            <Field label="دسته" htmlFor="kb-new-cat">
              <TreeSelect id="kb-new-cat" className="w-full" value={category ?? undefined} onChange={(v) => setCategory((v as string) ?? null)} treeData={treeData(tree)} allowClear treeDefaultExpandAll placeholder="بدون دسته" />
            </Field>
          ) : null}
          <Field label="نوع مقاله" hint="قالب همین نوع، بخش‌های نخستین پیش‌نویس را می‌سازد">
            <Select className="w-full" value={type} onChange={setType} options={types} showSearch optionFilterProp="label" />
          </Field>
          <Field label="عنوان" htmlFor="kb-new-title">
            <Input id="kb-new-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={250} placeholder="مثلاً: اتصال به VPN از خانه" autoFocus />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="زبان">
              <Select className="w-full" value={language} onChange={setLanguage} options={LANGUAGES} />
            </Field>
            {!internalBase ? (
              <Field label="خوانندگان">
                <Radio.Group value={visibility} onChange={(e) => setVisibility(e.target.value)} optionType="button" options={[{ value: "inherit", label: "مخاطبان پایگاه" }, { value: "internal", label: "فقط کارشناسان" }]} />
              </Field>
            ) : null}
          </div>
          <div>
            <Button type="primary" htmlType="submit" icon={<FilePlus2 {...I16} />} disabled={!title.trim() || !baseId} loading={create.isPending}>
              ساخت و نوشتن
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

// «این رکورد را کس دیگری تغییر داده است»: a save answered with 409 version_conflict. The dialog loads the record as
// it is now and shows what changed: my changes that do not collide are kept, a field both of us changed lets me
// choose (mine or theirs). «ادغام و ذخیره» saves the merge on the new version; «بارگذاری دوباره» drops my changes.
import { useEffect, useMemo, useState } from "react";
import { Button, Modal, Radio } from "antd";
import { useNotify } from "../../lib/hooks";
import { Loader } from "../../components/display";
import { useMe, useRecordActions } from "../data/hooks";
import { fieldOf, type Schema } from "../model/schema";
import { changedValues, sameValue } from "../model/values";
import type { RecordResult, RecordRow, TableMeta } from "../model/types";
import { FieldValue } from "../fields/display";
import { UserChip } from "../fields/display";

export interface ConflictDialogProps {
  def: TableMeta;
  schema: Schema;
  /** the record as it was when I started editing */
  base: RecordRow;
  /** my changes */
  mine: Record<string, unknown>;
  open: boolean;
  onMerged: (r: RecordResult) => void;
  onReload: () => void;
  onCancel: () => void;
}

export function ConflictDialog({ def, schema, base, mine, open, onMerged, onReload, onCancel }: ConflictDialogProps) {
  const actions = useRecordActions(def.key);
  const { userId, tz } = useMe();
  const n = useNotify();
  const [latest, setLatest] = useState<RecordResult | null>(null);
  const [choice, setChoice] = useState<Record<string, "mine" | "theirs">>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setLatest(null);
    setChoice({});
    actions.reload(base.id).then(setLatest, (e) => n.error(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, base.id]);

  const fields = useMemo(() => def.fields.filter((f) => f.name in mine), [def, mine]);
  const theirs = useMemo(() => (latest ? changedValues(base, latest.row, def.fields.filter((f) => !f.system && !f.base)) : {}), [latest, base, def]);
  const clashes = fields.filter((f) => f.name in theirs && !sameValue(theirs[f.name], mine[f.name]));
  const kept = fields.filter((f) => !clashes.includes(f));
  const display = { ...(latest?.display ?? {}) };
  const by = latest?.row.updated_by ? String(latest.row.updated_by) : null;

  const merge = async () => {
    if (!latest) return;
    const data: Record<string, unknown> = {};
    for (const f of kept) data[f.name] = mine[f.name];
    for (const f of clashes) if ((choice[f.name] ?? "mine") === "mine") data[f.name] = mine[f.name];
    setBusy(true);
    try {
      const r = Object.keys(data).length ? await actions.update(base.id, data, latest.row.version) : latest;
      n.ok("تغییرات شما روی نسخهٔ تازه ذخیره شد");
      onMerged(r);
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="این رکورد را کس دیگری تغییر داده است"
      onCancel={onCancel}
      width={620}
      destroyOnHidden
      footer={
        <div className="rk-cf-foot">
          <Button onClick={onCancel}>انصراف</Button>
          <Button onClick={onReload} disabled={busy}>
            بارگذاری دوباره (بدون تغییرات من)
          </Button>
          <Button type="primary" onClick={merge} loading={busy} disabled={!latest}>
            ادغام و ذخیره
          </Button>
        </div>
      }
    >
      {!latest ? (
        <div className="grid place-items-center py-6">
          <Loader />
        </div>
      ) : (
        <div className="rk-stack">
          <p className="rk-hint">
            از وقتی ویرایش را شروع کردید، {by ? <UserChip id={by} display={display} me={userId} /> : "همکاری"} این رکورد را تغییر داده است.
            {clashes.length ? " برای فیلدهایی که هر دو تغییر داده‌اید، مقدار درست را انتخاب کنید." : " تغییرات شما با تغییرات تازه برخوردی ندارد."}
          </p>
          {clashes.map((f) => (
            <fieldset key={f.name} className="rk-cf">
              <legend>{f.label}</legend>
              <Radio.Group value={choice[f.name] ?? "mine"} onChange={(e) => setChoice({ ...choice, [f.name]: e.target.value })}>
                <Radio value="mine">
                  <span className="rk-cf-k">مقدار من</span>
                  <FieldValue field={f} value={mine[f.name]} table={def.key} schema={schema} display={display} compact tz={tz} />
                </Radio>
                <Radio value="theirs">
                  <span className="rk-cf-k">مقدار تازه</span>
                  <FieldValue field={f} value={latest.row[f.name]} table={def.key} schema={schema} display={display} compact tz={tz} />
                </Radio>
              </Radio.Group>
            </fieldset>
          ))}
          {kept.length ? (
            <div className="rk-cf-kept">
              <span className="rk-lbl">این تغییرات شما نگه داشته می‌شوند</span>
              <ul>
                {kept.map((f) => (
                  <li key={f.name}>
                    <span className="rk-cf-k">{fieldOf(def, f.name)?.label}</span>
                    <FieldValue field={f} value={mine[f.name]} table={def.key} schema={schema} display={display} compact tz={tz} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

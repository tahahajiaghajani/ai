// «نسخه‌ها» and the problems drawer of the process designer (design F §8.4, package F6).
//   · «نسخه‌ها»: every published version, newest first — who published it and when, its note, what it changed (the
//     access settings apart), the current one marked — and «بازگرداندن به پیش‌نویس» from any of them (the published
//     version does not change until the next publish).
//   · The problems: the draft's errors and warnings grouped by step in reading order, the process's own first; a line
//     opens the step (and the inspector tab) or the settings where it is fixed.
import { Button, Drawer } from "antd";
import { CircleAlert, RotateCcw, TriangleAlert } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { FlowProblem } from "@shared/flows/types";
import type { ProcessGraph } from "@shared/process";
import { faDigits } from "@shared/format";
import { useOrg } from "../../../../lib/org";
import { errorText } from "../../../../lib/api";
import { useMe } from "../../../../records/data/hooks";
import { cx } from "../../../../components/blocks";
import { Chip, EmptyState, Loader } from "../../../../components/display";
import { useSheetSize } from "../fields/parts";
import { DESIGNER_KEYS, designerApi, type VersionRow } from "./api";
import { problemGroups, versionMeta, versionTitle } from "./model";
import { I14 } from "./parts";

export function VersionsDrawer({ id, canRestore, onRestore, onClose }: { id: string; canRestore: boolean; onRestore: (v: VersionRow) => void; onClose: () => void }) {
  const { api, orgId } = useOrg();
  const { tz } = useMe();
  const size = useSheetSize(560);
  const q = useQuery({ queryKey: DESIGNER_KEYS.versions(orgId, id), queryFn: () => designerApi.versions(api, id), staleTime: 0 });
  const names = q.data?.display ?? {};
  return (
    <Drawer open size={size} placement="left" title="نسخه‌ها" onClose={onClose} destroyOnHidden>
      {q.isLoading ? (
        <Loader />
      ) : q.error ? (
        <EmptyState compact title="نسخه‌ها خوانده نشد" description={errorText(q.error)} />
      ) : !q.data?.versions.length ? (
        <EmptyState compact title="هنوز نسخه‌ای منتشر نشده است" description="با هر انتشار، نسخه‌ای تازه این‌جا می‌آید؛ پرونده‌ها با نسخه‌ای که با آن آغاز شده‌اند پیش می‌روند." />
      ) : (
        <ol className="wfp-versions">
          {q.data.versions.map((v) => {
            const changes = v.diff?.changes ?? [];
            const access = v.diff?.access ?? [];
            return (
              <li key={v.id} className={cx("wfp-ver", v.current && "is-current")}>
                <div className="wfp-ver-h">
                  <strong>{versionTitle(v)}</strong>
                  {v.current ? <Chip tone="in">نسخهٔ جاری</Chip> : null}
                  {v.confidential ? <Chip>محرمانه</Chip> : null}
                  <span className="wfp-grow" />
                  {canRestore ? (
                    <Button size="small" icon={<RotateCcw {...I14} />} onClick={() => onRestore(v)}>
                      بازگرداندن به پیش‌نویس
                    </Button>
                  ) : null}
                </div>
                <p className="rk-hint">{versionMeta(v, names, tz)}</p>
                {v.note ? <p className="wfp-p">«{v.note}»</p> : null}
                {changes.length || access.length ? (
                  <details className="wfp-ver-d">
                    <summary>{`تغییرها (${faDigits(changes.length + access.length)})`}</summary>
                    <ul className="wfh-diff">
                      {changes.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                    {access.length ? (
                      <>
                        <h4 className="wfh-sub">دسترسی به پرونده‌ها</h4>
                        <ul className="wfh-diff">
                          {access.map((c) => (
                            <li key={c}>{c}</li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                  </details>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </Drawer>
  );
}

export function ProblemsDrawer({ problems, graph, onOpen, onClose }: { problems: FlowProblem[]; graph: ProcessGraph; onOpen: (p: FlowProblem) => void; onClose: () => void }) {
  const size = useSheetSize(480);
  const groups = problemGroups(problems, graph);
  return (
    <Drawer open size={size} placement="left" title="ایرادهای گردش‌کار" onClose={onClose} destroyOnHidden>
      {groups.length ? (
        <div className="wfp-problems">
          {groups.map((g) => (
            <section key={g.node ?? ""} aria-label={g.title}>
              <h3 className="wfp-sub">{g.title}</h3>
              <ul>
                {g.items.map((p, i) => (
                  <li key={i}>
                    <button type="button" className={cx("wfp-prob-btn", p.level === "error" ? "is-error" : "is-warning")} onClick={() => onOpen(p)}>
                      {p.level === "error" ? <CircleAlert {...I14} aria-hidden /> : <TriangleAlert {...I14} aria-hidden />}
                      <span className="sr-only">{p.level === "error" ? "ایراد:" : "هشدار:"}</span>
                      <span>{p.message}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="rk-hint">ایرادها انتشار را نگه می‌دارند؛ هشدارها فقط یادآوری‌اند.</p>
        </div>
      ) : (
        <EmptyState compact title="ایرادی نیست" description="این پیش‌نویس آمادهٔ انتشار است." />
      )}
    </Drawer>
  );
}

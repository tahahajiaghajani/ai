// The list page's state hook: kept in the URL (deep links, back/forward, «باز کردن در زبانهٔ تازه») or locally for
// embedded lists, columns per person and table (localStorage), the saved view the page started from, and the
// request it all adds up to.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type { Cond } from "@shared/model/conditions";
import { useOrg } from "../../lib/org";
import type { ListPreset } from "../extensions";
import { columnsKey, loadColumns, requestFields, sanitizeColumns, saveColumns, type ColumnPrefs, type KeyValueStore } from "../model/columns";
import { andAll, quickCond } from "../model/filter";
import { defaultSort, parseSort, type Schema } from "../model/schema";
import { emptyListState, readListState, writeListState, type ListState } from "../model/views";
import type { ListQuery, TableMeta } from "../model/types";
import { useMe } from "../data/hooks";

const storage = (): KeyValueStore | null => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
};

/** The page's starting state from the table and the module's preset. */
export function baseState(preset: ListPreset | undefined): Partial<ListState> {
  return { quick: preset?.quick ?? [], groupBy: preset?.groupBy ?? null, size: preset?.pageSize ?? 50, mode: "list", sort: "" };
}

/** List state in the URL (default) or in component state (`local`). */
export function useListState(preset: ListPreset | undefined, local = false) {
  const base = useMemo(() => baseState(preset), [preset]);
  const [params, setParams] = useSearchParams();
  const [own, setOwn] = useState<ListState>(() => emptyListState(base));
  const state = useMemo(() => (local ? own : readListState(params, base)), [local, own, params, base]);
  const set = useCallback(
    (patch: Partial<ListState> | ((s: ListState) => Partial<ListState>), opts: { replace?: boolean } = {}) => {
      const apply = (s: ListState): ListState => {
        const p = typeof patch === "function" ? patch(s) : patch;
        // a change of what is listed goes back to the first page
        const resets = ["filter", "quick", "q", "sort", "groupBy", "size", "view"].some((k) => k in p);
        return { ...s, ...(resets && !("page" in p) ? { page: 1 } : {}), ...p };
      };
      if (local) setOwn((s) => apply(s));
      else
        setParams(
          (prev) => {
            const next = writeListState(apply(readListState(prev, base)), base);
            // keep parameters other components own (e.g. a module's ?tab=)
            for (const [k, v] of prev) if (!["view", "filter", "quick", "q", "sort", "group", "size", "page", "mode"].includes(k)) next.set(k, v);
            return next;
          },
          { replace: opts.replace ?? true },
        );
    },
    [local, setParams, base],
  );
  return [state, set] as const;
}

/**
 * A person's columns of a table (preset defaults, saved per person; a view's columns override for the page). An
 * embedded list (a related list) keeps its own choice, apart from the table's main list.
 */
export function useColumns(def: TableMeta | undefined, schema: Schema | undefined, preset: ListPreset | undefined, embedded = false) {
  const { orgId } = useOrg();
  const { userId } = useMe();
  const key = def ? `${columnsKey(orgId, userId ?? "anon", def.key)}${embedded ? ".embedded" : ""}` : "";
  const [prefs, setPrefs] = useState<ColumnPrefs | null>(null);
  const [viewCols, setViewCols] = useState<string[] | null>(null);
  const loadedFor = useRef("");
  useEffect(() => {
    if (!def || loadedFor.current === key) return;
    loadedFor.current = key;
    const stored = storage()?.getItem(key);
    if (!stored && preset?.columns) setPrefs({ columns: sanitizeColumns(preset.columns, def, schema?.lookup) });
    else setPrefs(loadColumns(storage(), key, def, schema?.lookup));
  }, [def, key, preset, schema]);
  const columns = useMemo(() => {
    if (!def) return [];
    if (viewCols) return sanitizeColumns(viewCols, def, schema?.lookup);
    return prefs?.columns ?? sanitizeColumns(preset?.columns ?? [], def, schema?.lookup);
  }, [def, schema, prefs, viewCols, preset]);
  const setColumns = useCallback(
    (cols: string[]) => {
      if (!def) return;
      const next = { ...(prefs ?? {}), columns: sanitizeColumns(cols, def, schema?.lookup) };
      setViewCols(null);
      setPrefs(next);
      saveColumns(storage(), key, next, def);
    },
    [def, key, prefs, schema],
  );
  return { columns, setColumns, setViewColumns: setViewCols, widths: prefs?.widths ?? {} };
}

/** The list request of a state. */
export function listQuery(def: TableMeta, state: ListState, columns: string[], o: { fixed?: Cond | null; extraFields?: (string | null | undefined)[]; presetSort?: string } = {}): { query: ListQuery; filter: Cond | null } {
  const filter = andAll(o.fixed ?? null, state.filter, quickCond(def, state.quick));
  let sort = state.sort || o.presetSort || defaultSort(def);
  if (state.groupBy) {
    const rest = parseSort(sort).filter((p) => p.field !== state.groupBy);
    sort = [state.groupBy, ...rest.map((p) => `${p.desc ? "-" : ""}${p.field}`)].slice(0, 4).join(",");
  }
  return {
    filter,
    query: { filter, q: state.q.trim() || undefined, sort, page: state.page, size: state.size, fields: requestFields(def, columns, [state.groupBy, ...(o.extraFields ?? [])]) },
  };
}

# The record UI kit

Every ITSM screen that shows engine records — incident queues, change calendars, CMDB lists, KB articles, SLA
definitions — is built from the generic components in `src/ui/records`. They render any `TableDef` the way the engine
describes it (docs/spec/ENGINE.md): fields and their types, choice lists, state models and transitions, journal,
history, watchers, links, attachments, saved views and the organisation's customisation. A module describes its
tables once, registers them with `recordModule()`, and adds only what is specific to it through **extensions**.

Contents: [1 Layout of the kit](#1-layout-of-the-kit) · [2 A module in ten lines](#2-a-module-in-ten-lines) ·
[3 RecordList](#3-recordlist) · [4 RecordPage](#4-recordpage) · [5 Extensions](#5-extensions) ·
[6 Fields](#6-fields) · [7 FilterBuilder](#7-filterbuilder) · [8 Board, calendar, timeline](#8-board-calendar-timeline) ·
[9 UI policies](#9-ui-policies) · [10 Meta other services fill](#10-meta-other-services-fill) ·
[11 Designers and the form arrangement](#11-designers-and-the-form-arrangement) · [12 Data hooks](#12-data-hooks) ·
[13 Conventions](#13-conventions) · [14 Testing](#14-testing)

---

## 1. Layout of the kit

| path | what |
| --- | --- |
| `records/model/*` | pure logic, no React/antd, unit-tested: `schema` (options, labels, capabilities), `filter` (builder tree ⇄ `Cond`, operators, relative windows, quick filters), `columns` (defaults, persistence), `policies` (UI policies → form state), `layout` (tabs/sections), `activity` (journal + history stream), `views` (URL state, saved views), `calendar`, `kanban`, `sla` (timers, viewers), `values`, `mentions`, `colors`, `types` |
| `records/data/api.ts` | every route of the engine's HTTP API as a typed call (`recordsApi`), `uploadAttachment`, `attachmentUrl` |
| `records/data/hooks.ts` | React Query hooks and mutations (`useSchema`, `useTableDef`, `useRecordList`, `useRecord`, `useActivity`, `useRecordActions`, …) |
| `records/fields/*` | `FieldInput` (editors), `FieldValue` (read-only renderers), `RecordSelect`/`UserSelect`, `MarkdownEditor`, `RecordMarkdown`, tags |
| `records/filter/FilterBuilder.tsx` | the condition builder |
| `records/list/*` | `RecordList` with its toolbar (views, columns), bulk bar, export/import |
| `records/page/*` | `RecordPage`: header, form, transition and conflict dialogs, side panel, activity stream with composer |
| `records/board/*` | `KanbanBoard`, `CalendarView`, `TimelineView` |
| `records/admin/*` | designers: custom fields, choice lists, form layouts, saved views |
| `records/extensions.ts` | per-table extension registry, record paths, pluggable policy and holiday sources |
| `records/module.tsx` | `recordModule()` and `recordSearch()`; lazy route components |
| `records/index.ts` | the public barrel |
| `modules/records/index.tsx` | the generic routes `r/:table`, `r/:table/new`, `r/:table/:id`, «کارها» (`todo`) and the designers' routes |

Import `records/module` and `records/extensions` from a module's `index.tsx` (they are light); import components from
`records` (the barrel) only inside lazily loaded pages, so the kit stays out of the first bundle.

## 2. A module in ten lines

```tsx
// src/ui/modules/incident/index.tsx
import { Siren, ListTodo } from "lucide-react";
import { recordModule } from "../../records/module";

export const incidentUi = recordModule({
  key: "incident",
  space: { key: "service-desk", label: "میز خدمت", title: "میز خدمت", icon: Siren },
  group: { key: "incident", label: "رخدادها" },
  tables: [
    {
      table: "incident", path: "incidents", label: "رخدادها", noun: "رخداد", icon: Siren, area: "work", workspace: true,
      list: { preset: { quick: ["open"], board: { wip: { in_progress: 12 } } } },
      extensions: { cardFields: ["priority", "assigned_to", "sla_due"], policies: INCIDENT_POLICIES, sidePanels: [callerCard] },
    },
    { table: "incident_task", path: "incident-tasks", label: "کارهای رخداد", icon: ListTodo, section: "تعریف‌ها", newAction: false },
  ],
});
// then add `incidentUi` to UIS in src/ui/modules/registry.tsx
```

`recordModule` returns a `ModuleUi`: one nav group (items per table, «… تازه» actions in the palette), routes
`<path>`, `<path>/new`, `<path>/:id`, a palette search per table (number or words), and it registers the extensions
**with the table's path** — so every link to these records (references, links, kanban cards, search hits) opens the
module's pages. Tables a module does not register still work at `r/<table>`.

`RecordTableEntry`: `table`, `path`, `label`, `noun`, `icon`, `section`, `space`, `area`, `level`, `keywords`,
`hidden` (routes only), `workspace`, `count` (a live nav count), `search` (`false` or `{ group, minLength }`),
`newAction`, `list: { title, preset, actions }`, `extensions`.

A module that needs its own page composes the components instead:

```tsx
const Queue = () => <RecordList table="incident" title="صف من" preset={{ filter: { f: "assigned_to", op: "is_me" }, columns: [...] }} />;
const Incident = () => { const { id } = useParams(); return <RecordPage table="incident" id={id!} extensions={{ tabs: [ciMapTab] }} />; };
```

## 3. RecordList

`<RecordList table preset? title? actions? embedded? baseFilter? newDefaults? onOpen? />`

- **Server-side**: paging with the total, sort (click a sortable column), quick search (`q`: words in search fields or
  a record number), filter (FilterBuilder), quick filters («واگذارشده به من»، «گروه‌های من»، «باز»، «بدون کارشناس»،
  «پیگیری می‌کنم», derived from the table's fields), group-by with collapsible groups (counts from one aggregate).
- **State in the URL**: `?view=&filter=<json>&quick=&q=&sort=&group=&size=&page=&mode=` (only what differs from the
  defaults). Every list is a deep link; `embedded` lists keep their state locally.
- **Saved views** (`view` table): «همهٔ …», my views, shared views; the page opens with my default view, else a shared
  default; «ذخیرهٔ تغییرات این نما» (own views), «ذخیره به‌عنوان نمای جدید…» (name, share, default); a dot marks a
  page that differs from its view. Selecting a view copies its filter, search, sort, grouping, page size, columns
  and mode into the page — nothing is hidden, the builder shows the whole condition.
- **Columns**: the chooser shows, hides and orders columns (dot-walks allowed in `preset.columns`); the choice is kept
  per organisation, person and table (`itsm.cols.<org>.<user>.<table>` in localStorage) and travels in saved views.
- **Selection and bulk**: checkboxes, «انتخاب همهٔ n مورد» (the filter, ≤ 500), then واگذاری / تغییر وضعیت (asks for
  the fields the transition requires) / تغییر فیلد / پیگیری همه / حذف and the preset's `bulkActions`. Every action
  is confirmed where destructive and answered per record («۸ مورد به‌روز شد؛ ۲ مورد انجام نشد» → جزئیات).
- **Inline edit** of simple fields (a pencil on hover): one PATCH with the row's `version`, optimistic, rolled back
  on error; a stale version refreshes the list with a toast.
- **Export** («خروجی اکسل»): the server's export of the current filter and columns (labels resolved, ≤ 10 000 rows)
  written as RTL .xlsx with Persian headers and Jalali dates. **Import** («ورود از اکسل»): the platform's import sheet
  over `POST /r/:table/import` (dry run first; «شماره» updates existing records).
- **Modes**: فهرست / تابلو / تقویم / خط زمانی — offered when the table supports them (`features.kanban` or a state
  model; `features.calendar`; a start/end pair) or the preset says so (`preset.board|calendar|timeline|modes`).
- **Keyboard**: `j`/`k` move, `Enter` opens, `x` selects, `/` focuses the search, `Esc` clears the selection
  (physical keys: they work on the Persian layout too).
- **Phone**: cards (number, state, title, three facts) instead of a table; no sideways scroll.
- **Live**: lists refresh through «زنده» (the pulse) without losing scroll, selection or the open filter panel.

`ListPreset`: `filter` (always applied, shown as a quiet line), `columns`, `sort`, `quick`, `pageSize`, `groupBy`,
`modes`, `board: { field, wip, cardFields, swimlane }`, `calendar: { start, end? }`, `timeline: { start, end }`,
`rowTone(row) → "danger" | "warning" | null`, `bulkActions`, `emptyText`.

## 4. RecordPage

`<RecordPage table id="<uuid>|new" extensions? backTo? />`

- **Header**: back, the display value, the number, «آخرین تغییر», the state (a strong tag), priority, assignee,
  group, watchers, SLA timers (`meta.sla`), «X هم این رکورد را باز کرده است» (`meta.viewers`), the allowed
  transitions (`meta.transitions`) as buttons (the first three; the rest in «بیشتر»), «ویرایش», and «بیشتر»: copy
  link, watch / unwatch, print, delete (`meta.canDelete`), the module's `moreActions`.
- **Form**: view mode by default — values read-only, a pencil (or a double click) edits one field in place
  (pickers save on change; text, numbers and dates on Enter or ✓; Esc cancels). «ویرایش» turns the whole form into
  inputs with a sticky save bar (Alt+S saves, Esc cancels); only changed fields are sent, with the `version` the
  edit started from. Sections and tabs come from the layout (§11); UI policies apply live (§9); empty read-only
  values are left out in view mode; engine fields sit in a collapsed «اطلاعات سامانه».
- **Errors**: `validation` messages appear under their fields (the first one is focused); a missing required field is
  caught before the request. A transition that requires empty fields opens a dialog for exactly those fields.
- **Conflicts**: a 409 `version_conflict` opens «این رکورد را کس دیگری تغییر داده است»: my non-colliding changes
  are kept, a field both sides changed offers «مقدار من / مقدار تازه»; «ادغام و ذخیره» saves on the new version,
  «بارگذاری دوباره» drops my changes. While editing, a newer version arriving through «زنده» shows a warning.
- **Tabs**: the form's tabs, then the module's `tabs`, then the related lists of `def.form.related` (embedded
  `RecordList`s tied to this record; «تازه» from there pre-fills the parent field).
- **Side panel**: the module's `sidePanels`, then پیگیری‌کنندگان (watch, add or remove people), پیوست‌ها (drag and
  drop upload, image previews, download, delete), پیوندها (typed links with their Persian direction labels; add a
  link to any record), آخرین تغییرات. Cards fold; the choice is remembered.
- **Activity stream** (§ below the form): filter chips همه / یادداشت‌های عمومی / یادداشت‌های داخلی / سامانه; journal
  entries and field changes newest first (one save = one item; the creation is «این رکورد را ثبت کرد»).
- **Composer**: two tabs — «پاسخ به درخواست‌کننده» (public comment; plain surface, «درخواست‌کننده این پاسخ را
  می‌بیند») and «یادداشت داخلی» (work note; sea tint and a lock, «فقط کارشناسان …»; the default tab). Markdown with
  a toolbar, @mentions (type `@`, ↑/↓, Enter), attachments (uploaded to the record and attached to the entry),
  Ctrl+Enter posts, and the two module slots `cannedResponses` and `aiDraft` (nothing renders when absent).
- **New record** (`id="new"`): the definition's defaults (`$me`, `$today`, static values), URL parameters named like
  fields (`?parent_id=…`, `?due_at=…` — related lists and calendar days use this) and the extension's `defaults`.
  After «ثبت» the page moves to the new record.

## 5. Extensions

```ts
registerRecordExtensions("incident", {
  path: "incidents",                                   // set for you by recordModule
  list: { quick: ["open"], rowTone: (r) => (r.major ? "danger" : null) },
  policies: [{ when: { f: "major", op: "eq", v: true }, actions: [{ field: "problem_id", mandatory: true }], message: "رخداد عمده: مشکل را مشخص کنید" }],
  headerActions: (ctx) => <PromoteToMajor ctx={ctx} />,
  moreActions: [{ key: "dup", label: "ساخت رونوشت", run: (ctx) => duplicate(ctx) }],
  sidePanels: [{ key: "caller", title: "درخواست‌کننده", order: 10, render: (ctx) => <CallerCard id={ctx.row.caller_id} /> }],
  tabs: [{ key: "ci-map", label: "نقشهٔ وابستگی", render: (ctx) => <CiMap ci={ctx.row.ci_id} /> }],
  cannedResponses: (c) => <CannedPicker kind={c.kind} onPick={c.insert} />,
  aiDraft: (c) => <AiDraftButton record={c.record} onDraft={c.setText} />,
  cardFields: ["priority", "assigned_to", "sla_due"],
  defaults: (search) => ({ channel: search.get("channel") ?? "phone" }),
});
```

- `"*"` registers for every table. Registrations merge: arrays add up, a later scalar wins; `headerActions` of every
  registration render side by side. `registerRecordExtensions` returns an unregister function.
- `RecordContext` (what page widgets receive): `table`, `def`, `schema`, `row`, `display`, `meta`, `save(data) →
  Promise<boolean>` (PATCH with the version; conflicts open the dialog), `transition(to) → Promise<boolean>` (asks for
  required fields), `refresh()`.
- `ComposerContext` (the two slots): `record` (a RecordContext), `kind` (`comment` | `work_note`), `text`,
  `setText(text)`, `insert(text)` (at the caret).
- Paths: `tablePath(table)`, `recordPath(table, id)`, `newRecordPath(table)` — the module's path when registered,
  else `r/<table>`.
- Pluggable sources for services that come later: `setPolicySource((api, table) => Promise<UiPolicy[]>)` (the
  organisation's `ui_policy` rows) and `setHolidaySource((api, from, to) => Promise<Holiday[]>)` (the calendar
  service; `Holiday = { date, title, half? }`).

## 6. Fields

`<FieldInput field value onChange def schema row? display? tz disabled? waitingFor? status? compact? onCommit? onCancel? />`
and `<FieldValue field value table schema? display? compact? me? tz? />` cover every field type:

| type | editor | read-only |
| --- | --- | --- |
| string, email, url, phone, ip | input; LTR (Geist) for Latin values and `ltr` fields | text; mailto / external link (http(s) only) / tel; LTR isolates |
| text, markdown | textarea; RTL Markdown editor with toolbar and preview | pre-wrapped text; safe Markdown (no HTML, no images, mentions as chips) |
| int, decimal, money, percent | NumberInput (Persian digits, live grouping, «+» = ×1000) | tabular figures, never cut |
| rating, duration, bool | stars; hours + minutes; switch | stars; «۲ ساعت و ۳۰ دقیقه»; بله / خیر |
| date, datetime | Jalali DateInput; date + 24 h time in the organisation's zone | Jalali date (and time) |
| choice | segmented control (≤ 4 options) or searchable select with coloured tags; dependent lists wait for their parent | coloured tag (dot + word) |
| multichoice, tags, color | multi-select of tags; free tags (Enter, «،»); colour swatches | tags |
| ref, refs, group, user, users | `RecordSelect`: search by number or words, secondary line, «من» first for members, `refFilter` applied, link to open | links to the records; people with avatars; «محدود» for what the caller may not read |
| json, conditions | JSON text (checked on blur); FilterBuilder of the target table | formatted JSON; the condition as a Persian sentence |
| secret | write-only password box with the stored hint | «•••• abcd» |

`RecordSelect` (`table`, `value`, `onChange`, `multiple`, `filter`, `display`, `meFirst`, `openLink`) works for any
table; a target the organisation does not have yet renders as a disabled box. `UserSelect` = members with «من» first.

## 7. FilterBuilder

`<FilterBuilder def schema value={Cond|null} onChange display? walk? noSummary? tz? />` edits the engine's condition
JSON: nested groups («همهٔ شرط‌ها» / «یکی از شرط‌ها», «برعکس»; the «و/یا» word between rows toggles the group),
rows of field (with one dot-walk into readable references: «درخواست‌دهنده ← سمت»), operator (Persian labels, filter
operators only) and a value editor per type — options, records and members (with «من» and «گروه‌های من» shortcuts
that switch to `is_me` / `is_my_group`), numbers, Jalali dates, ranges, relative windows (presets «امروز»، «۷ روز
گذشته»، «این هفته»، «این ماه»، «ماه گذشته»… or any n units past/next). Incomplete rows stay on screen but are left
out of the value. The sentence under it is `describe()` from `@shared/model/conditions`. The model
(`records/model/filter.ts`: `fromCond`, `toCond`, `withField`, `withOp`, `quickFilters`, `encodeFilter`…) is pure.

## 8. Board, calendar, timeline

- `KanbanBoard` (`def`, `schema`, `field`, `filter`, `q`, `wip`, `cardFields`, `swimlane`, `onOpen`): columns from the
  state model (a drop takes the transition; a move the model has no transition for is refused with the reason; required
  fields are asked for), any choice (option order, inactive options left out), members/groups/references (the values
  an aggregate found, most used first) or yes/no; «بدون مقدار» where empty is allowed. WIP counts per column
  (`n/wip`, highlighted when full), optional swimlanes, one query per column (50 cards; the count says how many more).
  Every card has «انتقال به…» — the keyboard and touch alternative of dragging (WCAG 2.5.7). Moves are optimistic.
- `CalendarView` (`def`, `schema`, `start`, `end?`, `filter`, `q`, `onOpen`): Jalali month grid and week columns,
  Saturday first; Fridays and holidays (from `setHolidaySource`) shaded; today ringed; «+n مورد دیگر». Drag a record
  to another day — a date-time keeps its local time, an end moves with its start — or use «انتقال به» in its popover.
  A day's «+» starts a new record on that day. Phones get dots and the chosen day's agenda.
- `TimelineView` (`def`, `schema`, `start`, `end`, `filter`, `q`, `onOpen`): bars on a day scale (two weeks, four
  weeks, three months) packed into lanes, clipped ends marked, Fridays/holidays shaded, today marked.

The geometry (`monthGrid`, `weekOf`, `windowFilter`, `shiftValue`, `moveEvent`, `timelineBars`, `planDrop`,
`choiceColumns`) is pure and tested.

## 9. UI policies

```ts
interface UiPolicy {
  key?: string;
  when?: Cond | null;                  // on the form's current values; empty = always
  actions: { field: string; visible?: boolean; mandatory?: boolean; readonly?: boolean }[];
  message?: string; tone?: "info" | "warning";
  order?: number;                      // lower first; a later policy wins on the same field and property
  on?: "create" | "update" | "both";
}
```

`formState(def, row, policies, { mode, canWrite, locked, readonly, env, lookup })` (pure, `records/model/policies.ts`)
gives the hidden, required, read-only and «waiting for its parent» fields and the messages. Base rules: `hidden`
fields and (on a new record) engine fields are hidden; `system`, `base`, `readonly`, `meta.readonly`, a locked state
or no write access make a field read-only — a policy can never make such a field writable; `required` fields are
required. A mandatory field is never hidden; a field nobody can fill is not required. A policy whose condition cannot
be evaluated does not apply. Conditions see the person (`is_me`), the organisation's zone and clock; group and unit
operators need the server's environment and evaluate to false in the browser. The server re-checks mandatory and
read-only on every write path (the platform-services work adds the `ui_policy` table and plugs it in with
`setPolicySource`).

## 10. Meta other services fill

The page renders keys of `meta` that modules add with `registerRecordMeta` (ENGINE.md §6); the UI never computes
them.

- `meta.sla`: an array of timers, `{ timers: [...] }` or one timer. Each: `label|name|title`, `due_at|deadline|breach_at`,
  `start_at|started_at`, `paused` or `state: "paused"`, `breached`/`met` or `state: "breached" | "met" | "achieved"`,
  `percent|elapsed_pct` (0–100), `remaining_ms`. Chips show «۲ ساعت مانده» / «۳۵ دقیقه از موعد گذشته» / «متوقف» /
  «در موعد انجام شد», toned by the share used (75 % warning, breached danger), refreshed every 30 s; screen readers
  hear a change of tone only.
- `meta.viewers`: ids or `{ id | user_id, name, typing? }` of the people who have the record open (the caller is left
  out) → «X هم این رکورد را باز کرده است» / «… در حال نوشتن روی این رکورد است».
- Mentions in journal bodies are `@[نام](mention:<user uuid>)` (`formatMention`, `mentionedIds` in
  `records/model/mentions.ts`); notification services find the people with `mentionedIds(body)`.

## 11. Designers and the form arrangement

Settings › «سفارشی‌سازی» (area `settings`; editing needs `settings: edit`):

- **فیلدهای سفارشی** (`settings/fields?table=`): add, edit, deactivate and remove `u_*` fields (type, label, static
  options with colours or an existing choice list, reference target, section, help, required, list column, filter,
  search); relabel existing fields, change their help, make them required or a list column.
- **فهرست‌های گزینه** (`settings/choices?list=`): labels, colours, order, parent values, «فعال», new values — one save
  writes only what changed (rows of `choice`).
- **چیدمان فرم‌ها** (`settings/forms?table=`): tabs, sections and the order of fields, by drag and drop or the menus.
- **نماهای ذخیره‌شده** (`settings/views?table=`): the `view` table as a list (rename, share, default, delete); a view's
  page has «نمایش فهرست».

**The arrangement row.** A form layout is stored as **one** `custom_field` row per table named `"_form"`
(`FORM_ROW` in `@shared/model/arrangement`), whose `options` hold `{ tabs: [{ label, sections: [{ label, fields }] }] }`.
The engine (`buildSchema`, src/server/engine/schema.ts) never turns that row into a field; it cleans it
(`cleanArrangement`: labels trimmed, names checked, every field once, sizes capped) and sets `def.form.arrangement`
in `GET /meta/tables`. `formLayout(def)` (`records/model/layout.ts`) uses it; fields it does not name — a custom field
added later, a module upgrade — keep their default place (their `section` if the arrangement has one by that name,
else the first section). Without an arrangement the layout follows the definition: `form.tabs`, `form.sections`,
each field's `tab` and `section` (unsectioned fields join the first declared section). The state field, the number
and the watch list are never in the body; engine fields close the first tab. Deactivating or deleting the row returns
to the default layout.

## 12. Data hooks

| hook | query key | notes |
| --- | --- | --- |
| `useSchema()` / `useTableDef(key)` | `["records-meta", org]` | 5 min; `useRefreshSchema()` after a designer change |
| `useRecordList(table, query)` | `["records", org, table, query]` | POST `/query`, keeps the previous page while loading |
| `useAggregate(table, { filter, q, groupBy })` | `["records-agg", org, table, body]` | group counts, board columns |
| `useRecord(table, id)` | `["record", org, table, id]` | `{ row, display, meta }` |
| `useActivity(def, id, createdAt)` | `["record-activity", org, table, id]` | journal + history merged |
| `useLinks`, `useAttachments` | `["record-links" …]`, `["record-attachments" …]` | |
| `useViews(table)` | `["records-views", org, table]` | own and shared views |

All of these keys are registered with «زنده» (`registerLiveQueries`), so open screens refresh when another device
changes data; forms keep their own draft, so a refresh never resets what someone is typing.
`useRecordActions(table)` returns `create`, `update(id, data, version)`, `transition(id, to, data, version)`, `remove`,
`bulk`, `comment(id, kind, body, attachments)`, `watch(id, on, userId?)` (optimistic), `addLink`, `removeLink`,
`upload`, `removeAttachment`, `reload`, `refreshLists`; each updates the caches it knows and throws the server's
`ApiError` (Persian message; `isConflict(e)`, `fieldErrorsOf(e)` read it). `useViewActions(table)` writes views.

## 13. Conventions

- Design system only: `--ds-*` tokens and the bridge utilities, `records.css` classes prefixed `rk-`, named option
  colours mapped to tokens (`data-c`), light and dark from the tokens, no `transition: all`, Dusk only for the one
  primary action. Status is quiet: states and choices are a dot and a word on a light tint.
- RTL: logical properties; numbers, identifiers («TODO0000012»), e-mail, URLs and code are LTR isolates; Persian
  digits from DS Num; Jalali dates in the organisation's zone; figures never ellipsize.
- Every page starts with `PageHeader`; explanations belong in «راهنما», the screens carry one short hint at most.
- Accessibility: labels on every control, focus rings, `aria-live` only where something changes for the person
  (bulk results, SLA thresholds, the filter sentence), every drag has a click alternative, 24 px targets.
- Phone (≤ 640 px): cards instead of tables, single-column forms, the side panel under the form, boards scroll inside
  themselves — never the page sideways.
- Keyboard map: lists `j`/`k`/`Enter`/`x`/`/`/`Esc`; record `Alt+S` save, `Esc` cancel, double click or the pencil to
  edit a field; composer `Ctrl+Enter`, `Ctrl+B`/`Ctrl+I`, `@` mentions.

## 14. Testing

- Pure logic: `tests/ui-records-filter.test.ts` (builder ⇄ conditions, every default leaf valid for the engine),
  `tests/ui-records-policies.test.ts` (form state and policies), `tests/ui-records-columns.test.ts` (defaults,
  persistence, requests), `tests/ui-records-model.test.ts` (layout, arrangement, activity, mentions, values, SLA,
  calendar, kanban, URL state, saved views).
- Engine behaviour the UI relies on: `tests/ui-records-api.test.ts` (the arrangement row, saved views as the list
  writes them, version conflicts, bulk transitions).
- Screens: `node scripts/ui-shots.mjs` seeds demo `todo` records and screenshots the generic pages (list, board,
  calendar, timeline, grouping, a record, a new record, `r/:table`, the designers) in light, dark and at 375 px, and
  fails on console errors, failed API calls or a sideways scroll.

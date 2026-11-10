// «اسناد هوشمند» — the smart documents library of the AI layer: collections with their own sharing and the documents
// in them (the uploaded file is the record's attachment; its text is read per runtime into the AI index). Area
// `knowledge`: whoever reads knowledge may open the library, and each collection's row rule decides who sees it and its
// documents — the owner, the people, groups or units it is shared with, or everyone (in its workspace, when it has
// one). A document is readable exactly when its collection is (the dot-walk below carries the collection's access).
// Imported by the UI: keep it free of server imports.
import type { Cond } from "../model/conditions";
import type { Option, TableDef } from "../model/types";

export const DOC_COLLECTION = "doc_collection";
export const DOC_DOCUMENT = "doc_document";

export const DOC_SHARING: Option[] = [
  { value: "private", label: "خصوصی", color: "gray" },
  { value: "groups", label: "گروه‌ها", color: "blue" },
  { value: "units", label: "واحدهای سازمانی", color: "teal" },
  { value: "unit_trees", label: "واحدها با زیرمجموعه‌ها", color: "teal" },
  { value: "everyone", label: "همه", color: "green" },
];

export const DOC_CLASSES: Option[] = [
  { value: "public", label: "عمومی", color: "green" },
  { value: "internal", label: "داخلی", color: "blue" },
  { value: "confidential", label: "محرمانه", color: "orange" },
  { value: "secret", label: "سری", color: "red" },
];

export const DOC_STATUSES: Option[] = [
  { value: "ingesting", label: "در حال خواندن", color: "blue" },
  { value: "ready", label: "آماده", color: "green" },
  { value: "needs_ocr", label: "نیازمند خواندن تصویر", color: "gold" },
  { value: "failed", label: "ناموفق", color: "red" },
];

export const DOC_LANGS: Option[] = [
  { value: "fa", label: "فارسی" },
  { value: "en", label: "انگلیسی" },
  { value: "mixed", label: "فارسی و انگلیسی" },
  { value: "other", label: "دیگر" },
];

/**
 * Who reads a collection (on top of a read grant in `knowledge`): its owner, the people named, members of the groups
 * (sharing «گروه‌ها»), members of the units — the unit itself (sharing «واحدها») or with its sub-units («واحدها با
 * زیرمجموعه‌ها», `in_my_unit_line`) —, or everyone.
 */
export const COLLECTION_READ: Cond = {
  or: [
    { f: "owner_id", op: "is_me" },
    { f: "share_users", op: "is_me" },
    { and: [{ f: "sharing", op: "eq", v: "groups" }, { f: "share_groups", op: "in_my_groups" }] },
    { and: [{ f: "sharing", op: "eq", v: "units" }, { f: "share_units", op: "in_my_unit" }] },
    { and: [{ f: "sharing", op: "eq", v: "unit_trees" }, { f: "share_units", op: "in_my_unit_line" }] },
    { f: "sharing", op: "eq", v: "everyone" },
  ],
};

const collection: TableDef = {
  key: DOC_COLLECTION,
  table: "sm_doc_collections",
  label: "مجموعهٔ اسناد",
  plural: "مجموعه‌های اسناد",
  icon: "library",
  module: "docs",
  area: "knowledge",
  description: "پوشهٔ اسناد هوشمند با اشتراک خودش: خصوصی، گروه‌ها، واحدها یا همه",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 16 },
    { name: "classification", label: "طبقه‌بندی", type: "choice", choices: DOC_CLASSES, default: "internal", required: true, list: true, filter: true, span: 8, help: "اسناد «سری» در پاسخ‌های هوش مصنوعی به کار نمی‌روند." },
    { name: "description", label: "توضیح", type: "text", search: true, span: 24 },
    { name: "owner_id", label: "مالک", type: "user", default: "$me", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "sharing", label: "اشتراک با", type: "choice", choices: DOC_SHARING, default: "private", required: true, list: true, filter: true, span: 12 },
    { name: "share_users", label: "افراد", type: "users", span: 24, help: "این افراد در هر حالت اشتراک مجموعه را می‌بینند." },
    { name: "share_groups", label: "گروه‌ها", type: "refs", ref: "group", span: 12 },
    { name: "share_units", label: "واحدها", type: "refs", ref: "org_unit", span: 12 },
    { name: "ai_enabled", label: "در پاسخ‌های هوش مصنوعی", type: "bool", default: true, list: true, filter: true, span: 12 },
    { name: "open_contrib", label: "بینندگان سند بیفزایند", type: "bool", default: false, span: 12 },
  ],
  scope: { own: ["owner_id"] },
  rowAccess: { read: COLLECTION_READ },
  list: { columns: ["name", "classification", "sharing", "owner_id", "ai_enabled", "updated_at"], order: "name" },
};

const document: TableDef = {
  key: DOC_DOCUMENT,
  table: "sm_doc_documents",
  label: "سند",
  plural: "اسناد",
  icon: "file-text",
  module: "docs",
  area: "knowledge",
  description: "پرونده‌ای که متنش خوانده و برای پرسش و پاسخ هوشمند نمایه شده است",
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 300, list: true, search: true, sort: true, span: 24 },
    { name: "collection_id", label: "مجموعه", type: "ref", ref: DOC_COLLECTION, required: true, list: true, filter: true, index: true, span: 12 },
    { name: "owner_id", label: "بارگذار", type: "user", default: "$me", readonly: true, list: true, filter: true, index: true, span: 12 },
    { name: "status", label: "وضعیت", type: "choice", choices: DOC_STATUSES, default: "ingesting", readonly: true, list: true, filter: true, span: 8 },
    { name: "language", label: "زبان", type: "choice", choices: DOC_LANGS, readonly: true, list: true, filter: true, span: 8 },
    { name: "pages", label: "صفحه‌ها", type: "int", readonly: true, list: true, sort: true, span: 8 },
    { name: "file_id", label: "شناسهٔ پرونده", type: "string", readonly: true, hidden: true, maxLength: 36, ltr: true, audit: false },
    { name: "file_name", label: "نام پرونده", type: "string", readonly: true, maxLength: 200, ltr: true, span: 12 },
    { name: "mime", label: "نوع پرونده", type: "string", readonly: true, maxLength: 120, ltr: true, span: 6 },
    { name: "size", label: "اندازه (بایت)", type: "int", readonly: true, span: 6 },
    { name: "ocr", label: "خوانده با مدل تصویر", type: "bool", default: false, readonly: true, span: 8 },
    { name: "error", label: "پیام خواندن", type: "string", readonly: true, maxLength: 500, span: 24 },
    { name: "summary", label: "خلاصه", type: "text", search: true, span: 24 },
    { name: "tags", label: "برچسب‌ها", type: "tags", filter: true, span: 24 },
  ],
  scope: { own: ["owner_id"] },
  // readable exactly when the collection is (a walk into a collection the caller may not read yields nothing)
  rowAccess: { read: { f: "collection_id.name", op: "nempty" } },
  features: { attachments: true, tags: true, rag: true },
  ai: { title: "title", text: ["summary"] },
  list: { columns: ["title", "collection_id", "status", "pages", "language", "updated_at"], order: "-updated_at" },
};

export const DOCS_TABLES: TableDef[] = [collection, document];

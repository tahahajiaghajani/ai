// The sync protocol each Windows app last spoke (protocol 16, docs/spec/ENGINE.md §13): recorded on its device by
// /sync/register, /sync/push and /sync/pull — also when the server refuses it for another protocol — so that the
// platform console's «برنامه‌های ویندوز قدیمی» counts the apps it cut off. Their version string does not tell them: a
// 1.1.0-beta app (protocol 15) reports the same 1.1.0 as this build. Null: not known yet (a device registered before).
export default /* sql */ `
alter table sm_devices add column if not exists sync_protocol integer;
`;

// The tables whose records a requester follows in the portal (the server's item registry, portal/common.ts): an order
// or a report that produced one of these opens its ticket page; anything else opens «درخواست‌های من».
export const portalItemTableKeys: readonly string[] = ["incident", "request_item", "portal_feedback", "interaction"];

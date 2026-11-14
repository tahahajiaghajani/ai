// «گردش‌کارها» (design F D13, §8): the settings pages of fields, forms, organisational roles and workflows, and the
// person's own «گردش‌کارها». Each package's folder adds one part (./parts.ts) — list it here, in menu order. The kit's
// components live in ./kit (F5k); the pages of the other packages arrive with their parts:
//   admin/fields, admin/forms, admin/positions (F5) · admin/hub, admin/process, admin/lifecycle (F6) · user (F7).
import type { ModuleUi } from "../registry";
import { assemble } from "./parts";
import { kitPart } from "./kit/routes";
import { fieldsPart } from "./admin/fields/routes";
import { formsPart } from "./admin/forms/routes";
import { positionsPart } from "./admin/positions/routes";
import { hubPart } from "./admin/hub/routes";
import { processPart } from "./admin/process/routes";
import { lifecyclePart } from "./admin/lifecycle/routes";
import { userPart } from "./user/routes";
// the position picker and the «پیوست» widget in every record form
import "./kit/register";
// the home page's card «موارد منتظر شما»
import "./user/register";

// settings: «فیلدها», «فرم‌ها», «گردش‌کارها», «نقش‌های سازمانی» (design F §8); the process designer and the lifecycle
// editor open from the hub
export const workflowsUi: ModuleUi = assemble([fieldsPart, formsPart, hubPart, processPart, positionsPart, lifecyclePart, userPart, kitPart]);

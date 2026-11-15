// Stub of the «mecm» kind (design A §6.1): listed by the server registry, never run — it refuses with
// «هنوز ساخته نشده». Package DA3b owns this file and replaces it with the kind's code; the registry stays as it is.
import { z } from "zod";
import { mecm as descriptor } from "@shared/discovery/kinds/mecm";
import { notBuilt } from "../kind";

export const connector = notBuilt(descriptor, z.record(z.string(), z.unknown()));

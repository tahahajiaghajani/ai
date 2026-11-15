// Stub of the «endpoint_central» kind (design A §6.1): listed by the server registry, never run — it refuses with
// «هنوز ساخته نشده». Package DA3b owns this file and replaces it with the kind's code; the registry stays as it is.
import { z } from "zod";
import { endpoint_central as descriptor } from "@shared/discovery/kinds/endpoint_central";
import { notBuilt } from "../kind";

export const connector = notBuilt(descriptor, z.record(z.string(), z.unknown()));

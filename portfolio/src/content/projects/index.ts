import type { Project } from "@/content/types";
import { turbine } from "@/content/projects/turbine";
import { tejarat } from "@/content/projects/tejarat";
import { tejaratNewEpm } from "@/content/projects/tejarat-new-epm";
import { milling } from "@/content/projects/milling";
import { taskflow } from "@/content/projects/taskflow";
import { pars } from "@/content/projects/pars";
import { parsSuite } from "@/content/projects/pars-suite";
import { sendo } from "@/content/projects/sendo";
import { celin } from "@/content/projects/celin";
import { haftkhan } from "@/content/projects/haftkhan";

/** Every case study, in the order the site tells them. */
export const PROJECTS: Project[] = [tejaratNewEpm, tejarat, taskflow, sendo, pars, turbine, parsSuite, celin, milling, haftkhan];

export function getProject(slug: string): Project | undefined {
  return PROJECTS.find((p) => p.slug === slug);
}

export function nextProject(slug: string): Project {
  const shown = PROJECTS.filter((p) => p.tier !== "lab");
  const i = shown.findIndex((p) => p.slug === slug);
  return shown[(i + 1) % shown.length] ?? PROJECTS[0];
}

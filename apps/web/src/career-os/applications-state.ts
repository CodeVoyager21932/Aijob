import type { CaseStage } from "./domain";

export type ApplicationsView = "board" | "list";
export type ApplicationsSort = "updated" | "deadline";
export type ApplicationsStageFilter = CaseStage | "all";

export interface ApplicationsViewState {
  view: ApplicationsView;
  stage: ApplicationsStageFilter;
  city: string;
  sort: ApplicationsSort;
}

export const defaultApplicationsViewState: ApplicationsViewState = {
  view: "board",
  stage: "all",
  city: "all",
  sort: "updated",
};

const validStages = new Set<ApplicationsStageFilter>([
  "all",
  "interested",
  "preparing",
  "applied",
  "interviewing",
  "resolved",
]);

export function readApplicationsViewState(params: URLSearchParams): ApplicationsViewState {
  const view = params.get("view");
  const stage = params.get("stage") as ApplicationsStageFilter | null;
  const city = params.get("city")?.trim();
  const sort = params.get("sort");

  return {
    view: view === "list" ? "list" : "board",
    stage: stage && validStages.has(stage) ? stage : "all",
    city: city || "all",
    sort: sort === "deadline" ? "deadline" : "updated",
  };
}

export function writeApplicationsViewState(
  current: URLSearchParams,
  nextState: ApplicationsViewState,
): URLSearchParams {
  const next = new URLSearchParams(current);
  next.set("view", nextState.view);
  next.set("stage", nextState.stage);
  next.set("city", nextState.city);
  next.set("sort", nextState.sort);
  return next;
}

export function canonicalizeApplicationsSearchParams(current: URLSearchParams): URLSearchParams {
  return writeApplicationsViewState(current, readApplicationsViewState(current));
}

export function areSearchParamsEqual(left: URLSearchParams, right: URLSearchParams): boolean {
  return left.toString() === right.toString();
}

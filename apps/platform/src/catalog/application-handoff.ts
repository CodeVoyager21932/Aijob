import type { ApplicationHandoff, ApplicationLinkKind } from "@aijob/contracts";
import { ApplicationHandoffSchema } from "@aijob/contracts";

export interface ApplicationHandoffInput {
  /** The classification frozen on the source revision / published version. */
  applicationLinkKind: ApplicationLinkKind;
  /**
   * The apply URL after it has been re-validated against the source's current navigation
   * allowlist. `null` means either the source states no apply URL, or a previously stored URL
   * is no longer accepted by the current allowlist. Callers must pass the allowlist result,
   * never the raw stored URL.
   */
  approvedApplyUrl: string | null;
  /** Locator fields used only for official-list fallback so the user can find the job again. */
  title: string;
  sourceJobId: string;
}

/**
 * Builds the typed application handoff for a public job.
 *
 * The three states are kept honest:
 * - `exact`: the source exposes a per-job apply/detail URL and that URL is still allowlisted.
 * - `official_list_fallback`: the source only exposes a shared official list; we surface that
 *   list plus a locator (title + source job id) so the user searches for the job, and we never
 *   present it as a direct apply link.
 * - `missing`: the source states no apply URL, or a stored URL is no longer allowlisted. We
 *   never fall back to `source_url` to fabricate an apply entry.
 */
export function buildApplicationHandoff(input: ApplicationHandoffInput): ApplicationHandoff {
  if (input.applicationLinkKind === "exact" && input.approvedApplyUrl) {
    return ApplicationHandoffSchema.parse({ kind: "exact", url: input.approvedApplyUrl });
  }
  if (input.applicationLinkKind === "official_list_fallback" && input.approvedApplyUrl) {
    return ApplicationHandoffSchema.parse({
      kind: "official_list_fallback",
      url: input.approvedApplyUrl,
      locator: { title: input.title, sourceJobId: input.sourceJobId },
    });
  }
  return ApplicationHandoffSchema.parse({
    kind: "missing",
    reasonCode: applicationHandoffMissingReason(input),
  });
}

function applicationHandoffMissingReason(input: ApplicationHandoffInput): string {
  if (input.applicationLinkKind === "missing") return "APPLICATION_LINK_MISSING";
  // The source classified a URL, but the current allowlist rejects it.
  return "APPLICATION_LINK_NOT_ALLOWED";
}

/**
 * The compatibility `officialLink` only carries a direct apply URL for the `exact` state.
 * Fallback and missing must not populate it, so older clients cannot treat a shared list URL
 * as a direct apply link.
 */
export function exactOfficialLink(handoff: ApplicationHandoff): string | null {
  return handoff.kind === "exact" ? handoff.url : null;
}

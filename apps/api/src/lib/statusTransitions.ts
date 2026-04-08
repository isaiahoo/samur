// SPDX-License-Identifier: AGPL-3.0-only
import type { HelpRequestStatus, IncidentStatus } from "@samur/shared";

/**
 * Valid status transitions for help requests.
 * open → claimed → in_progress → completed
 * Any state → cancelled (except completed)
 */
const HELP_REQUEST_TRANSITIONS: Record<HelpRequestStatus, HelpRequestStatus[]> = {
  open: ["claimed", "cancelled"],
  claimed: ["in_progress", "open", "cancelled"], // can unclaim back to open
  in_progress: ["completed", "cancelled"],
  completed: [], // terminal
  cancelled: ["open"], // can reopen
};

const INCIDENT_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  unverified: ["verified", "false_report"],
  verified: ["resolved", "false_report"],
  resolved: ["verified"], // can reopen
  false_report: ["unverified"], // can revert
};

export function isValidHelpRequestTransition(
  from: HelpRequestStatus,
  to: HelpRequestStatus
): boolean {
  if (from === to) return true; // no-op is always valid
  return HELP_REQUEST_TRANSITIONS[from].includes(to);
}

export function isValidIncidentTransition(
  from: IncidentStatus,
  to: IncidentStatus
): boolean {
  if (from === to) return true;
  return INCIDENT_TRANSITIONS[from].includes(to);
}

export function getHelpRequestTransitionError(
  from: HelpRequestStatus,
  to: HelpRequestStatus
): string | null {
  if (isValidHelpRequestTransition(from, to)) return null;
  const allowed = HELP_REQUEST_TRANSITIONS[from];
  if (allowed.length === 0) {
    return `Запрос в статусе «${from}» нельзя изменить`;
  }
  return `Нельзя перевести запрос из «${from}» в «${to}». Допустимые: ${allowed.join(", ")}`;
}

export function getIncidentTransitionError(
  from: IncidentStatus,
  to: IncidentStatus
): string | null {
  if (isValidIncidentTransition(from, to)) return null;
  const allowed = INCIDENT_TRANSITIONS[from];
  if (allowed.length === 0) {
    return `Инцидент в статусе «${from}» нельзя изменить`;
  }
  return `Нельзя перевести инцидент из «${from}» в «${to}». Допустимые: ${allowed.join(", ")}`;
}

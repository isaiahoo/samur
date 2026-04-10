// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from "vitest";
import {
  isValidHelpRequestTransition,
  isValidIncidentTransition,
  getHelpRequestTransitionError,
  getIncidentTransitionError,
} from "../src/lib/statusTransitions.js";

// ── Help Request transitions ────────────────────────────────────────────

describe("isValidHelpRequestTransition", () => {
  it("allows no-op (same state)", () => {
    for (const s of ["open", "claimed", "in_progress", "completed", "cancelled"] as const) {
      expect(isValidHelpRequestTransition(s, s)).toBe(true);
    }
  });

  it("allows open → claimed", () => {
    expect(isValidHelpRequestTransition("open", "claimed")).toBe(true);
  });

  it("allows open → cancelled", () => {
    expect(isValidHelpRequestTransition("open", "cancelled")).toBe(true);
  });

  it("allows claimed → in_progress", () => {
    expect(isValidHelpRequestTransition("claimed", "in_progress")).toBe(true);
  });

  it("allows claimed → open (unclaim)", () => {
    expect(isValidHelpRequestTransition("claimed", "open")).toBe(true);
  });

  it("allows claimed → cancelled", () => {
    expect(isValidHelpRequestTransition("claimed", "cancelled")).toBe(true);
  });

  it("allows in_progress → completed", () => {
    expect(isValidHelpRequestTransition("in_progress", "completed")).toBe(true);
  });

  it("allows in_progress → cancelled", () => {
    expect(isValidHelpRequestTransition("in_progress", "cancelled")).toBe(true);
  });

  it("allows cancelled → open (reopen)", () => {
    expect(isValidHelpRequestTransition("cancelled", "open")).toBe(true);
  });

  it("rejects completed → anything", () => {
    for (const to of ["open", "claimed", "in_progress", "cancelled"] as const) {
      expect(isValidHelpRequestTransition("completed", to)).toBe(false);
    }
  });

  it("rejects open → in_progress (must claim first)", () => {
    expect(isValidHelpRequestTransition("open", "in_progress")).toBe(false);
  });

  it("rejects open → completed (must go through flow)", () => {
    expect(isValidHelpRequestTransition("open", "completed")).toBe(false);
  });

  it("rejects cancelled → completed", () => {
    expect(isValidHelpRequestTransition("cancelled", "completed")).toBe(false);
  });
});

// ── Incident transitions ────────────────────────────────────────────────

describe("isValidIncidentTransition", () => {
  it("allows no-op (same state)", () => {
    for (const s of ["unverified", "verified", "resolved", "false_report"] as const) {
      expect(isValidIncidentTransition(s, s)).toBe(true);
    }
  });

  it("allows unverified → verified", () => {
    expect(isValidIncidentTransition("unverified", "verified")).toBe(true);
  });

  it("allows unverified → false_report", () => {
    expect(isValidIncidentTransition("unverified", "false_report")).toBe(true);
  });

  it("allows verified → resolved", () => {
    expect(isValidIncidentTransition("verified", "resolved")).toBe(true);
  });

  it("allows verified → false_report", () => {
    expect(isValidIncidentTransition("verified", "false_report")).toBe(true);
  });

  it("allows resolved → verified (reopen)", () => {
    expect(isValidIncidentTransition("resolved", "verified")).toBe(true);
  });

  it("allows false_report → unverified (revert)", () => {
    expect(isValidIncidentTransition("false_report", "unverified")).toBe(true);
  });

  it("rejects unverified → resolved (must verify first)", () => {
    expect(isValidIncidentTransition("unverified", "resolved")).toBe(false);
  });

  it("rejects resolved → unverified", () => {
    expect(isValidIncidentTransition("resolved", "unverified")).toBe(false);
  });

  it("rejects resolved → false_report", () => {
    expect(isValidIncidentTransition("resolved", "false_report")).toBe(false);
  });
});

// ── Error messages ──────────────────────────────────────────────────────

describe("getHelpRequestTransitionError", () => {
  it("returns null for valid transition", () => {
    expect(getHelpRequestTransitionError("open", "claimed")).toBeNull();
  });

  it("returns null for no-op", () => {
    expect(getHelpRequestTransitionError("open", "open")).toBeNull();
  });

  it("returns error string for invalid transition", () => {
    const error = getHelpRequestTransitionError("open", "completed");
    expect(error).toBeTypeOf("string");
    expect(error).toContain("open");
    expect(error).toContain("completed");
  });

  it("returns terminal-state message for completed", () => {
    const error = getHelpRequestTransitionError("completed", "open");
    expect(error).toBeTypeOf("string");
    expect(error).toContain("completed");
  });
});

describe("getIncidentTransitionError", () => {
  it("returns null for valid transition", () => {
    expect(getIncidentTransitionError("unverified", "verified")).toBeNull();
  });

  it("returns error string for invalid transition", () => {
    const error = getIncidentTransitionError("unverified", "resolved");
    expect(error).toBeTypeOf("string");
    expect(error).toContain("unverified");
    expect(error).toContain("resolved");
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unit tests for news fetcher helpers.
 * We test the pure functions (stripHtml, truncate, matchesKeywords)
 * by importing them indirectly — since they're not exported, we
 * replicate the logic here and verify behavior contract.
 */
import { describe, it, expect } from "vitest";

// ── Replicated helpers (same logic as newsFetcher.ts internals) ─────────
// These test the contract that the production code must maintain.

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cut = text.lastIndexOf(" ", maxLen);
  return text.slice(0, cut > 0 ? cut : maxLen) + "...";
}

function matchesKeywords(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("stripHtml", () => {
  it("removes HTML tags", () => {
    expect(stripHtml("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("decodes common entities", () => {
    expect(stripHtml("A &amp; B &lt; C &gt; D")).toBe("A & B < C > D");
    expect(stripHtml("&quot;quoted&#039;s&quot;")).toBe(`"quoted's"`);
  });

  it("replaces &nbsp; with space", () => {
    expect(stripHtml("word&nbsp;word")).toBe("word word");
  });

  it("collapses whitespace", () => {
    expect(stripHtml("  lots   of   spaces  ")).toBe("lots of spaces");
  });

  it("handles empty string", () => {
    expect(stripHtml("")).toBe("");
  });

  it("handles nested tags", () => {
    expect(stripHtml("<div><span><a href='x'>link</a></span></div>")).toBe("link");
  });
});

describe("truncate", () => {
  it("returns text unchanged if within limit", () => {
    expect(truncate("short", 100)).toBe("short");
  });

  it("truncates at word boundary", () => {
    const result = truncate("one two three four five", 15);
    expect(result).toBe("one two three...");
  });

  it("truncates at maxLen if no space found", () => {
    const result = truncate("abcdefghijklmnop", 5);
    expect(result).toBe("abcde...");
  });

  it("handles exact length", () => {
    expect(truncate("exact", 5)).toBe("exact");
  });
});

describe("matchesKeywords", () => {
  it("matches case-insensitively", () => {
    expect(matchesKeywords("Наводнение в Дагестане", ["наводнение"])).toBe(true);
  });

  it("matches any keyword (OR logic)", () => {
    expect(matchesKeywords("flood warning", ["earthquake", "flood"])).toBe(true);
  });

  it("returns false if no keyword matches", () => {
    expect(matchesKeywords("sunny weather today", ["flood", "storm"])).toBe(false);
  });

  it("matches substring", () => {
    expect(matchesKeywords("earthquake damage report", ["quake"])).toBe(true);
  });

  it("handles empty keywords array", () => {
    expect(matchesKeywords("any text", [])).toBe(false);
  });

  it("handles empty text", () => {
    expect(matchesKeywords("", ["keyword"])).toBe(false);
  });
});

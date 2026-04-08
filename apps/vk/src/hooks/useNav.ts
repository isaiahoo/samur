// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useCallback } from "react";

export type PanelId = "map" | "report" | "help" | "help-form" | "alerts" | "info";

export function useNav(initial: PanelId = "map") {
  const [activePanel, setActivePanel] = useState<PanelId>(initial);
  const [history, setHistory] = useState<PanelId[]>([initial]);

  const go = useCallback((panel: PanelId) => {
    setHistory((h) => [...h, panel]);
    setActivePanel(panel);
  }, []);

  const goBack = useCallback(() => {
    setHistory((h) => {
      if (h.length <= 1) return h;
      const next = h.slice(0, -1);
      setActivePanel(next[next.length - 1]);
      return next;
    });
  }, []);

  return { activePanel, go, goBack };
}

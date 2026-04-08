// SPDX-License-Identifier: AGPL-3.0-only
import { useUIStore } from "../store/ui.js";

export function Toast() {
  const toast = useUIStore((s) => s.toast);
  if (!toast) return null;

  const colorMap = {
    success: "toast--success",
    error: "toast--error",
    info: "toast--info",
  };

  return (
    <div className={`toast ${colorMap[toast.type]}`}>
      {toast.message}
    </div>
  );
}

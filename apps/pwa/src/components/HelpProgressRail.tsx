// SPDX-License-Identifier: AGPL-3.0-only
import type { HelpResponseStatus } from "@samur/shared";

const STEPS: Array<{ key: Exclude<HelpResponseStatus, "cancelled">; label: string }> = [
  { key: "responded", label: "Откликнулся" },
  { key: "on_way",    label: "В пути" },
  { key: "arrived",   label: "На месте" },
  { key: "helped",    label: "Помог" },
];

interface Props {
  status: HelpResponseStatus;
  // For the author view — label adapts ("Откликнулись" vs "Вы откликнулись").
  perspective?: "self" | "author";
}

export function HelpProgressRail({ status, perspective = "self" }: Props) {
  if (status === "cancelled") return null;

  const currentIdx = STEPS.findIndex((s) => s.key === status);
  const prefix = perspective === "self" ? "Вы " : "";

  return (
    <div className="progress-rail" role="progressbar" aria-valuemin={0} aria-valuemax={3} aria-valuenow={currentIdx}>
      {STEPS.map((step, i) => {
        const state: "done" | "current" | "upcoming" =
          i < currentIdx ? "done" : i === currentIdx ? "current" : "upcoming";
        return (
          <div key={step.key} className={`progress-rail-step progress-rail-step--${state}`}>
            <div className="progress-rail-dot" aria-hidden="true">
              {state === "done" ? "✓" : state === "current" ? "●" : ""}
            </div>
            <div className="progress-rail-label">
              {i === currentIdx && perspective === "self" && i < 3
                ? prefix + step.label.toLowerCase()
                : step.label}
            </div>
            {i < STEPS.length - 1 && (
              <div className={`progress-rail-connector progress-rail-connector--${i < currentIdx ? "done" : "upcoming"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

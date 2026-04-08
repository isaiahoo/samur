// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  onClose: () => void;
}

export function BottomSheet({ children, onClose }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div
        ref={sheetRef}
        className="sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" />
        <div className="sheet-content">{children}</div>
      </div>
    </div>
  );
}

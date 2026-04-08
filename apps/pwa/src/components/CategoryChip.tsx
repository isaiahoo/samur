// SPDX-License-Identifier: AGPL-3.0-only
interface Props {
  label: string;
  active: boolean;
  onClick: () => void;
}

export function CategoryChip({ label, active, onClick }: Props) {
  return (
    <button
      type="button"
      className={`chip ${active ? "chip--active" : ""}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

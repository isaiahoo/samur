// SPDX-License-Identifier: AGPL-3.0-only
export function Spinner({ size = 32 }: { size?: number }) {
  return (
    <div className="spinner-container">
      <div className="spinner" style={{ width: size, height: size }} />
    </div>
  );
}

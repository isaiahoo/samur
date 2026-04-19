// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router-dom";

/**
 * 152-ФЗ consent at registration. Single required checkbox covering
 * both processing AND distribution — the policy text at /privacy
 * describes both, so accepting it grants both. The earlier two-checkbox
 * UX scared off too many users; we collapsed to one.
 *
 * Caller is responsible for keeping the submit button disabled while
 * `processing === false`.
 */

interface Props {
  processing: boolean;
  onProcessingChange: (next: boolean) => void;
  disabled?: boolean;
}

export function ConsentCheckboxes({
  processing,
  onProcessingChange,
  disabled = false,
}: Props) {
  return (
    <div className="consent-checkboxes">
      <label className="consent-checkbox">
        <input
          type="checkbox"
          checked={processing}
          onChange={(e) => onProcessingChange(e.target.checked)}
          disabled={disabled}
          required
        />
        <span className="consent-checkbox-text">
          Я ознакомлен(а) с{" "}
          <Link to="/privacy" target="_blank" rel="noopener noreferrer">
            Политикой конфиденциальности
          </Link>
          {" "}и даю согласие на обработку персональных данных
        </span>
      </label>
    </div>
  );
}

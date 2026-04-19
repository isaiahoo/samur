// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router-dom";

/**
 * 152-ФЗ consents at registration. Two checkboxes:
 *   - processing: required (152-ФЗ ст. 6) — submit must stay disabled
 *     until this is checked. Caller enforces this.
 *   - distribution: optional (152-ФЗ ст. 10.1). When unchecked, the
 *     user's items are hidden from the public/anonymous map and only
 *     visible to logged-in volunteers in geofilter.
 *
 * The legal text lives here in one place — never duplicate it across
 * the four registration flows. Mirrored on the server side by
 * lib/consentVersion.ts (same policy file drives both).
 */

interface Props {
  processing: boolean;
  distribution: boolean;
  onProcessingChange: (next: boolean) => void;
  onDistributionChange: (next: boolean) => void;
  disabled?: boolean;
}

export function ConsentCheckboxes({
  processing,
  distribution,
  onProcessingChange,
  onDistributionChange,
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

      <label className="consent-checkbox">
        <input
          type="checkbox"
          checked={distribution}
          onChange={(e) => onDistributionChange(e.target.checked)}
          disabled={disabled}
        />
        <span className="consent-checkbox-text">
          Согласен(на) на распространение моих данных (имя, заявки) на
          публичной карте Кунак. Без этого согласия ваши заявки видны
          только волонтёрам в радиусе.
        </span>
      </label>
    </div>
  );
}

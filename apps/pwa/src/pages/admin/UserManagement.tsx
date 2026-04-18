// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useCallback, useRef } from "react";
import { formatRelativeTime } from "@samur/shared";
import {
  getUsers,
  forceLogoutUser,
  ApiError,
  type AdminUserSummary,
} from "../../services/api.js";
import { Spinner } from "../../components/Spinner.js";
import { useUIStore, confirmAction } from "../../store/ui.js";
import { useAuthStore } from "../../store/auth.js";

const ROLE_LABELS: Record<string, string> = {
  resident: "Житель",
  volunteer: "Волонтёр",
  coordinator: "Координатор",
  admin: "Админ",
};

const PAGE_SIZE = 50;

export function UserManagement() {
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const showToast = useUIStore((s) => s.showToast);
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [search]);

  // Reset offset whenever the search term changes so we don't land on
  // an empty page 3 of a narrower result set.
  useEffect(() => {
    setOffset(0);
  }, [debouncedSearch]);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getUsers({ limit: PAGE_SIZE, offset, search: debouncedSearch });
      setUsers((res.data ?? []) as AdminUserSummary[]);
      setTotal(res.meta?.total ?? 0);
    } catch {
      showToast("Не удалось загрузить список пользователей", "error");
    } finally {
      setLoading(false);
    }
  }, [offset, debouncedSearch, showToast]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const handleForceLogout = async (u: AdminUserSummary) => {
    const ok = await confirmAction({
      title: "Выгнать пользователя из всех сессий?",
      message: `${u.name ?? u.phone ?? u.id} потеряет доступ на всех устройствах — токен JWT будет аннулирован, открытые сокеты закрыты. Пользователь сможет войти снова.`,
      confirmLabel: "Выгнать",
      kind: "destructive",
    });
    if (!ok) return;
    try {
      await forceLogoutUser(u.id);
      showToast("Сессии пользователя аннулированы", "success");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Ошибка";
      showToast(msg, "error");
    }
  };

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="admin-users">
      <div className="admin-filter-row">
        <input
          type="search"
          className="form-input form-input--sm"
          placeholder="Поиск по имени или телефону"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="admin-users-count">
          {total} {total === 1 ? "пользователь" : "пользователей"}
        </span>
      </div>

      {loading ? (
        <Spinner />
      ) : users.length === 0 ? (
        <div className="empty-state">
          <p>{debouncedSearch ? "Никого не найдено" : "Пользователей нет"}</p>
        </div>
      ) : (
        <>
          <ul className="user-list">
            {users.map((u) => {
              const isSelf = u.id === currentUserId;
              const providerLabels: string[] = [];
              if (u.phone) providerLabels.push("тел");
              if (u.tgId) providerLabels.push("TG");
              if (u.vkId) providerLabels.push("VK");
              return (
                <li key={u.id} className="user-row">
                  <div className="user-row-main">
                    <div className="user-row-name">{u.name ?? "—"}</div>
                    <div className="user-row-meta">
                      <span className={`user-row-role user-row-role--${u.role}`}>
                        {ROLE_LABELS[u.role] ?? u.role}
                      </span>
                      {u.phone && <span className="user-row-phone">{u.phone}</span>}
                      {providerLabels.length > 0 && (
                        <span className="user-row-providers">{providerLabels.join(" · ")}</span>
                      )}
                      <span className="user-row-joined">с {formatRelativeTime(u.createdAt)}</span>
                    </div>
                  </div>
                  <div className="user-row-actions">
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => handleForceLogout(u)}
                      disabled={isSelf}
                      title={isSelf ? "Для выхода из собственных сессий используйте профиль" : undefined}
                    >
                      Выгнать
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {totalPages > 1 && (
            <div className="admin-users-pager">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                ← Назад
              </button>
              <span className="admin-users-page-info">
                стр. {page} из {totalPages}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Вперёд →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

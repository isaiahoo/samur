// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useCallback } from "react";
import type { NewsArticle } from "@samur/shared";
import { formatRelativeTime } from "@samur/shared";
import { getNews } from "../services/api.js";
import { Spinner } from "../components/Spinner.js";
import { PullToRefresh } from "../components/PullToRefresh.js";

const FEED_LABELS: Record<string, string> = {
  "mchs-dagestan-forecasts": "МЧС",
  "ria-dagestan": "РИА Дагестан",
  "interfax-south": "Интерфакс",
  "tass": "ТАСС",
};

const FEED_COLORS: Record<string, string> = {
  "mchs-dagestan-forecasts": "#dc2626",
  "ria-dagestan": "#2563eb",
  "interfax-south": "#7c3aed",
  "tass": "#059669",
};

export function NewsPage() {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeFeed, setActiveFeed] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchNews = useCallback(async (p = 1, feed: string | null = null) => {
    setLoading(true);
    setError(false);
    try {
      const params: Record<string, string | number | boolean> = {
        limit: 20,
        page: p,
        sort: "published_at",
        order: "desc",
      };
      if (feed) params.feedId = feed;

      const res = await getNews(params);
      const items = (res.data ?? []) as NewsArticle[];
      setArticles(p === 1 ? items : (prev) => [...prev, ...items]);
      setTotal(res.meta?.total ?? 0);
    } catch {
      if (p === 1) setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPage(1);
    fetchNews(1, activeFeed);
  }, [fetchNews, activeFeed]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchNews(next, activeFeed);
  };

  const hasMore = articles.length < total;

  return (
    <PullToRefresh onRefresh={() => fetchNews(1, activeFeed)} disabled={loading && articles.length === 0}>
    <div className="news-page">
      <div className="news-filters">
        <button
          className={`news-filter-chip ${activeFeed === null ? "news-filter-chip--active" : ""}`}
          onClick={() => setActiveFeed(null)}
        >
          Все
        </button>
        {Object.entries(FEED_LABELS).map(([id, label]) => (
          <button
            key={id}
            className={`news-filter-chip ${activeFeed === id ? "news-filter-chip--active" : ""}`}
            onClick={() => setActiveFeed(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && articles.length === 0 ? (
        <div className="empty-state">
          <p>Не удалось загрузить новости</p>
          <button className="btn btn-secondary" onClick={() => fetchNews(1, activeFeed)}>Повторить</button>
        </div>
      ) : loading && articles.length === 0 ? (
        <Spinner />
      ) : articles.length === 0 ? (
        <div className="empty-state">
          <p>Нет новостей</p>
        </div>
      ) : (
        <>
          <div className="news-list">
            {articles.map((a) => (
              <NewsCard key={a.id} article={a} />
            ))}
          </div>

          {hasMore && (
            <div className="news-load-more">
              <button
                className="news-load-more-btn"
                onClick={loadMore}
                disabled={loading}
              >
                {loading ? "Загрузка..." : "Показать ещё"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
    </PullToRefresh>
  );
}

function NewsCard({ article }: { article: NewsArticle }) {
  const feedLabel = FEED_LABELS[article.feedId] ?? article.feedId;
  const feedColor = FEED_COLORS[article.feedId] ?? "#71717a";

  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className="news-card"
    >
      {article.imageUrl && (
        <div className="news-card-image">
          <img
            src={article.imageUrl}
            alt=""
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}
      <div className="news-card-content">
        <div className="news-card-meta">
          <span
            className="news-feed-badge"
            style={{ backgroundColor: feedColor }}
          >
            {feedLabel}
          </span>
          <span className="news-card-time">
            {formatRelativeTime(article.publishedAt)}
          </span>
        </div>
        <h3 className="news-card-title">{article.title}</h3>
        {article.summary && (
          <p className="news-card-summary">{article.summary}</p>
        )}
      </div>
    </a>
  );
}

-- CreateTable
CREATE TABLE IF NOT EXISTS "news_articles" (
    "id" TEXT NOT NULL,
    "feed_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "body" TEXT,
    "url" TEXT NOT NULL,
    "image_url" TEXT,
    "category" TEXT,
    "published_at" TIMESTAMP(3) NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "news_articles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "news_articles_feed_id_external_id_key" ON "news_articles"("feed_id", "external_id");
CREATE INDEX IF NOT EXISTS "news_articles_feed_id_published_at_idx" ON "news_articles"("feed_id", "published_at");
CREATE INDEX IF NOT EXISTS "news_articles_published_at_idx" ON "news_articles"("published_at");
CREATE INDEX IF NOT EXISTS "news_articles_deleted_at_idx" ON "news_articles"("deleted_at");

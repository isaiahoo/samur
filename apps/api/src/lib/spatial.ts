// SPDX-License-Identifier: AGPL-3.0-only
import { prisma } from "@samur/db";
import { Prisma } from "@prisma/client";

/**
 * Build a Prisma raw SQL WHERE fragment for ST_DWithin geo-filtering.
 * Returns SQL to append to a WHERE clause, or empty string if no geo params.
 */
export function geoWithinClause(
  table: string,
  geoLat?: number,
  geoLng?: number,
  radiusMeters?: number
): Prisma.Sql | null {
  if (geoLat == null || geoLng == null || radiusMeters == null) return null;
  return Prisma.sql`ST_DWithin(
    ${Prisma.raw(`"${table}"."location"`)},
    ST_SetSRID(ST_MakePoint(${geoLng}, ${geoLat}), 4326)::geography,
    ${radiusMeters}
  )`;
}

/**
 * Build a bounding box WHERE fragment for quick rect filtering.
 */
export function boundsClause(
  table: string,
  north?: number,
  south?: number,
  east?: number,
  west?: number
): Prisma.Sql | null {
  if (north == null || south == null || east == null || west == null) return null;
  return Prisma.sql`${Prisma.raw(`"${table}"."lat"`)} BETWEEN ${south} AND ${north}
    AND ${Prisma.raw(`"${table}"."lng"`)} BETWEEN ${west} AND ${east}`;
}

/**
 * Get IDs of records within a geo radius using PostGIS.
 * This runs a raw query and returns IDs that can be used in a Prisma `where: { id: { in: ids } }`.
 */
export async function getIdsWithinRadius(
  table: string,
  geoLat: number,
  geoLng: number,
  radiusMeters: number
): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM ${Prisma.raw(`"${table}"`)}
    WHERE "location" IS NOT NULL
      AND "deleted_at" IS NULL
      AND ST_DWithin(
        "location",
        ST_SetSRID(ST_MakePoint(${geoLng}, ${geoLat}), 4326)::geography,
        ${radiusMeters}
      )
  `;
  return rows.map((r) => r.id);
}

/**
 * Get IDs within a bounding box (faster than ST_DWithin for large areas).
 */
export async function getIdsWithinBounds(
  table: string,
  north: number,
  south: number,
  east: number,
  west: number
): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM ${Prisma.raw(`"${table}"`)}
    WHERE "deleted_at" IS NULL
      AND "lat" BETWEEN ${south} AND ${north}
      AND "lng" BETWEEN ${west} AND ${east}
  `;
  return rows.map((r) => r.id);
}

export interface ClusterRow {
  cluster_id: number;
  lat: number;
  lng: number;
  count: number;
  source_type: string;
  most_urgent: string;
}

export interface PointRow {
  id: string;
  lat: number;
  lng: number;
  source_type: string;
  sub_type: string;
  severity: string;
  status: string;
}

/**
 * Cluster incidents + help_requests using PostGIS ST_ClusterDBSCAN.
 * At low zoom (< 12): cluster nearby points. At high zoom: return individuals.
 */
export async function getMapClusters(
  zoom: number,
  south: number,
  west: number,
  north: number,
  east: number
): Promise<{ clusters: ClusterRow[]; points: PointRow[] }> {
  // Clamp zoom to valid range to prevent Infinity/0 in epsilon calc
  zoom = Math.min(Math.max(zoom, 0), 22);
  if (zoom >= 12) {
    const points = await prisma.$queryRaw<PointRow[]>`
      SELECT id, lat, lng, 'incident' as source_type, type::text as sub_type,
             severity::text as severity, status::text as status
      FROM incidents
      WHERE deleted_at IS NULL
        AND lat BETWEEN ${south} AND ${north}
        AND lng BETWEEN ${west} AND ${east}
      UNION ALL
      SELECT id, lat, lng, 'help_request' as source_type, category::text as sub_type,
             urgency::text as severity, status::text as status
      FROM help_requests
      WHERE deleted_at IS NULL
        AND lat BETWEEN ${south} AND ${north}
        AND lng BETWEEN ${west} AND ${east}
    `;
    return { clusters: [], points };
  }

  // Cluster with DBSCAN — eps in degrees, roughly scaled by zoom
  // At zoom 8: ~0.1 degrees (~11km), at zoom 11: ~0.01 degrees (~1km)
  const eps = 0.5 / Math.pow(2, zoom - 6);
  const minPoints = 2;

  const clusters = await prisma.$queryRaw<ClusterRow[]>`
    WITH all_points AS (
      SELECT id, lat, lng, location, 'incident' as source_type,
             severity::text as urgency_rank, type::text as sub_type
      FROM incidents
      WHERE deleted_at IS NULL
        AND lat BETWEEN ${south} AND ${north}
        AND lng BETWEEN ${west} AND ${east}
      UNION ALL
      SELECT id, lat, lng, location, 'help_request' as source_type,
             urgency::text as urgency_rank, category::text as sub_type
      FROM help_requests
      WHERE deleted_at IS NULL
        AND lat BETWEEN ${south} AND ${north}
        AND lng BETWEEN ${west} AND ${east}
    ),
    clustered AS (
      SELECT *,
        ST_ClusterDBSCAN(location, ${eps}, ${minPoints}) OVER () as cid
      FROM all_points
      WHERE location IS NOT NULL
    )
    SELECT
      cid as cluster_id,
      AVG(lat) as lat,
      AVG(lng) as lng,
      COUNT(*)::int as count,
      MODE() WITHIN GROUP (ORDER BY source_type) as source_type,
      CASE
        WHEN bool_or(urgency_rank = 'critical') THEN 'critical'
        WHEN bool_or(urgency_rank = 'high' OR urgency_rank = 'urgent') THEN 'high'
        WHEN bool_or(urgency_rank = 'medium') THEN 'medium'
        ELSE 'low'
      END as most_urgent
    FROM clustered
    WHERE cid IS NOT NULL
    GROUP BY cid
  `;

  const points = await prisma.$queryRaw<PointRow[]>`
    WITH all_points AS (
      SELECT id, lat, lng, location, 'incident' as source_type,
             type::text as sub_type, severity::text as severity, status::text as status
      FROM incidents
      WHERE deleted_at IS NULL
        AND lat BETWEEN ${south} AND ${north}
        AND lng BETWEEN ${west} AND ${east}
      UNION ALL
      SELECT id, lat, lng, location, 'help_request' as source_type,
             category::text as sub_type, urgency::text as severity, status::text as status
      FROM help_requests
      WHERE deleted_at IS NULL
        AND lat BETWEEN ${south} AND ${north}
        AND lng BETWEEN ${west} AND ${east}
    ),
    clustered AS (
      SELECT *,
        ST_ClusterDBSCAN(location, ${eps}, ${minPoints}) OVER () as cid
      FROM all_points
      WHERE location IS NOT NULL
    )
    SELECT id, lat, lng, source_type, sub_type, severity, status
    FROM clustered
    WHERE cid IS NULL
  `;

  return { clusters, points };
}

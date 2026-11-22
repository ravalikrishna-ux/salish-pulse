-- SalishPulse V1 Initial PostgreSQL + PostGIS Schema
-- Enables spatial geofencing, spatio-temporal sighting storage, SRKW coarsened public geometry,
-- idempotent multi-source reports, anti-fatigue alert deliveries, and conservation freeze state.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Canonical deduplicated sighting clusters
CREATE TABLE IF NOT EXISTS public.sighting_clusters (
  id TEXT PRIMARY KEY,
  lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN 47.0 AND 49.05),
  lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -123.5 AND -122.1),
  geom GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
  ) STORED,
  display_lat DOUBLE PRECISION NOT NULL CHECK (display_lat BETWEEN 47.0 AND 49.05),
  display_lng DOUBLE PRECISION NOT NULL CHECK (display_lng BETWEEN -123.5 AND -122.1),
  display_geom GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(display_lng, display_lat), 4326)::geography
  ) STORED,
  is_coarsened BOOLEAN NOT NULL DEFAULT TRUE,
  coarsening_radius_meters INTEGER NOT NULL DEFAULT 750 CHECK (coarsening_radius_meters >= 0),
  location_name TEXT NOT NULL,
  corridor TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'Unknown',
  speed_knots DOUBLE PRECISION NOT NULL DEFAULT 4.5,
  ecotype TEXT NOT NULL DEFAULT 'Unknown' CHECK (ecotype IN ('SRKW', 'Biggs', 'Offshore', 'Unknown')),
  pod TEXT,
  count INTEGER CHECK (count IS NULL OR (count > 0 AND count <= 100)),
  behaviors TEXT[] NOT NULL DEFAULT '{}',
  confidence_score DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  confidence_tier TEXT NOT NULL DEFAULT 'community' CHECK (confidence_tier IN ('unverified', 'community', 'corroborated', 'verified')),
  corroboration_count INTEGER NOT NULL DEFAULT 1 CHECK (corroboration_count >= 1),
  sources TEXT[] NOT NULL DEFAULT '{}',
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sighting_clusters_geom
  ON public.sighting_clusters USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_sighting_clusters_display_geom
  ON public.sighting_clusters USING GIST (display_geom);

CREATE INDEX IF NOT EXISTS idx_sighting_clusters_last_seen_at
  ON public.sighting_clusters (last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_sighting_clusters_ecotype_tier
  ON public.sighting_clusters (ecotype, confidence_tier, last_seen_at DESC);

-- 2. Raw corroborating source reports (idempotent per source + external_id)
CREATE TABLE IF NOT EXISTS public.sighting_reports (
  id TEXT PRIMARY KEY,
  cluster_id TEXT NOT NULL REFERENCES public.sighting_clusters(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  external_id TEXT,
  author TEXT,
  source_url TEXT,
  raw_text TEXT NOT NULL DEFAULT '',
  lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN 47.0 AND 49.05),
  lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -123.5 AND -122.1),
  geom GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
  ) STORED,
  direction TEXT NOT NULL DEFAULT 'Unknown',
  ecotype TEXT NOT NULL DEFAULT 'Unknown',
  pod TEXT,
  count INTEGER,
  observed_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trust_weight DOUBLE PRECISION NOT NULL DEFAULT 0.55 CHECK (trust_weight >= 0 AND trust_weight <= 1),
  CONSTRAINT uq_sighting_reports_source_external_id UNIQUE (source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_sighting_reports_cluster_id
  ON public.sighting_reports (cluster_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_sighting_reports_geom
  ON public.sighting_reports USING GIST (geom);

-- 3. Persistent geofenced & favorite-beach push alert subscriptions
CREATE TABLE IF NOT EXISTS public.alert_subscriptions (
  id TEXT PRIMARY KEY DEFAULT ('sub_' || encode(gen_random_bytes(8), 'hex')),
  channel TEXT NOT NULL CHECK (channel IN ('expo', 'web_push')),
  push_token TEXT,
  web_push_json JSONB,
  favorite_spot_ids TEXT[] NOT NULL DEFAULT '{}',
  home_lat DOUBLE PRECISION CHECK (home_lat IS NULL OR home_lat BETWEEN 47.0 AND 49.05),
  home_lng DOUBLE PRECISION CHECK (home_lng IS NULL OR home_lng BETWEEN -123.5 AND -122.1),
  home_geom GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
    CASE
      WHEN home_lat IS NOT NULL AND home_lng IS NOT NULL
      THEN ST_SetSRID(ST_MakePoint(home_lng, home_lat), 4326)::geography
      ELSE NULL
    END
  ) STORED,
  radius_km DOUBLE PRECISION NOT NULL DEFAULT 10 CHECK (radius_km > 0 AND radius_km <= 100),
  max_eta_minutes INTEGER NOT NULL DEFAULT 45 CHECK (max_eta_minutes >= 5 AND max_eta_minutes <= 240),
  min_confidence TEXT NOT NULL DEFAULT 'corroborated' CHECK (min_confidence IN ('unverified', 'community', 'corroborated', 'verified')),
  ecotypes TEXT[] NOT NULL DEFAULT ARRAY['SRKW', 'Biggs', 'Offshore', 'Unknown'],
  quiet_hours_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  quiet_start_hour SMALLINT NOT NULL DEFAULT 21 CHECK (quiet_start_hour BETWEEN 0 AND 23),
  quiet_end_hour SMALLINT NOT NULL DEFAULT 6 CHECK (quiet_end_hour BETWEEN 0 AND 23),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_home_geom
  ON public.alert_subscriptions USING GIST (home_geom);

CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_active
  ON public.alert_subscriptions (active) WHERE active = TRUE;

-- 4. Alert delivery audit log (enforces 45-min per-cluster cooldown & max 4/day cap)
CREATE TABLE IF NOT EXISTS public.alert_deliveries (
  id TEXT PRIMARY KEY DEFAULT ('dlv_' || encode(gen_random_bytes(8), 'hex')),
  subscription_id TEXT NOT NULL REFERENCES public.alert_subscriptions(id) ON DELETE CASCADE,
  cluster_id TEXT NOT NULL REFERENCES public.sighting_clusters(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('expo', 'web_push')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'dry_run', 'failed')),
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_alert_deliveries_sub_sent
  ON public.alert_deliveries (subscription_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_deliveries_sub_cluster_sent
  ON public.alert_deliveries (subscription_id, cluster_id, sent_at DESC);

-- 5. Singleton Conservation Freeze state controlled by authorized marine partners
CREATE TABLE IF NOT EXISTS public.conservation_freeze_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  active BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT,
  corridors TEXT[] NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.conservation_freeze_state (id, active, reason, corridors)
VALUES (1, FALSE, NULL, '{}')
ON CONFLICT (id) DO NOTHING;

-- Helper ranking function for confidence tiers
CREATE OR REPLACE FUNCTION public.confidence_tier_rank(p_tier TEXT)
RETURNS INTEGER
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE p_tier
    WHEN 'verified' THEN 3
    WHEN 'corroborated' THEN 2
    WHEN 'community' THEN 1
    ELSE 0
  END;
$$;

-- 6. PostGIS RPC: Find eligible alert subscribers within geofence or tracking favorite spots,
--    strictly enforcing 45-minute per-cluster cooldown and max 4 alerts per 24-hour cap.
CREATE OR REPLACE FUNCTION public.find_eligible_alert_subscribers(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_ecotype TEXT,
  p_confidence_tier TEXT,
  p_cluster_id TEXT,
  p_cooldown_minutes INTEGER DEFAULT 45,
  p_daily_cap INTEGER DEFAULT 4
)
RETURNS TABLE (
  id TEXT,
  channel TEXT,
  push_token TEXT,
  web_push_json JSONB,
  favorite_spot_ids TEXT[],
  home_lat DOUBLE PRECISION,
  home_lng DOUBLE PRECISION,
  radius_km DOUBLE PRECISION,
  max_eta_minutes INTEGER,
  min_confidence TEXT,
  ecotypes TEXT[],
  quiet_hours_enabled BOOLEAN,
  quiet_start_hour SMALLINT,
  quiet_end_hour SMALLINT,
  distance_km DOUBLE PRECISION
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_point GEOGRAPHY := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;
  v_cluster_rank INTEGER := public.confidence_tier_rank(p_confidence_tier);
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.channel,
    s.push_token,
    s.web_push_json,
    s.favorite_spot_ids,
    s.home_lat,
    s.home_lng,
    s.radius_km,
    s.max_eta_minutes,
    s.min_confidence,
    s.ecotypes,
    s.quiet_hours_enabled,
    s.quiet_start_hour,
    s.quiet_end_hour,
    CASE
      WHEN s.home_geom IS NOT NULL THEN ROUND((ST_Distance(s.home_geom, v_point) / 1000.0)::numeric, 2)::double precision
      ELSE NULL
    END AS distance_km
  FROM public.alert_subscriptions s
  WHERE s.active = TRUE
    AND v_cluster_rank >= public.confidence_tier_rank(s.min_confidence)
    AND (
      COALESCE(array_length(s.ecotypes, 1), 0) = 0
      OR p_ecotype = ANY(s.ecotypes)
    )
    AND (
      (s.home_geom IS NOT NULL AND ST_DWithin(s.home_geom, v_point, s.radius_km * 1000.0))
      OR COALESCE(array_length(s.favorite_spot_ids, 1), 0) > 0
    )
    -- 45-minute per-cluster anti-fatigue cooldown
    AND NOT EXISTS (
      SELECT 1
      FROM public.alert_deliveries d
      WHERE d.subscription_id = s.id
        AND d.cluster_id = p_cluster_id
        AND d.status IN ('sent', 'dry_run')
        AND d.sent_at >= NOW() - make_interval(mins => p_cooldown_minutes)
    )
    -- Daily alert cap (default max 4/day)
    AND (
      SELECT COUNT(*)
      FROM public.alert_deliveries d
      WHERE d.subscription_id = s.id
        AND d.status IN ('sent', 'dry_run')
        AND d.sent_at >= NOW() - INTERVAL '24 hours'
    ) < p_daily_cap;
END;
$$;

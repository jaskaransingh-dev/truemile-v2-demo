-- Default: seeds for today. To seed a specific date pass -v valid_date="'2026-03-24'"
-- Example: psql "$DATABASE_URL" -v valid_date="'2026-03-24'" -f scripts/market_conditions_seed.sql
\if :{?valid_date}
\else
\set valid_date CURRENT_DATE
\endif
--
-- MarketSnapshot table creation + full US freight market seed
-- Equipment types: REEFER, DRY_VAN, FLATBED
-- MCI scores set to 0 (neutral placeholder) — update from DAT iQ screenshot
--
-- MCI score → capacity label thresholds (per DAT documentation):
--   Very Tight:       +84 to +100
--   Moderately Tight: +44 to +83
--   Slightly Tight:   +9  to +43
--   Neutral:          -20 to +8
--   Slightly Loose:   -30 to -21
--   Moderately Loose: -35 to -31
--   Very Loose:      -100 to -36
--
-- NOTE: Prisma schema uses TrailerType enum with DRY_VAN (not VAN).
-- equipment_type_enum intentionally uses VAN for DAT market data alignment.
-- If you align MarketSnapshot with Prisma's TrailerType, change VAN → DRY_VAN
-- here and in any market-projection lookup code.

-- equipment_type_enum: idempotent creation via DO block (CREATE TYPE has no IF NOT EXISTS).
DO $$ BEGIN
  CREATE TYPE equipment_type_enum AS ENUM ('REEFER', 'DRY_VAN', 'FLATBED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "MarketSnapshot" (
  id                SERIAL               PRIMARY KEY,
  city              VARCHAR(100)         NOT NULL,
  state             CHAR(2)              NOT NULL,
  equipment_type    equipment_type_enum  NOT NULL DEFAULT 'REEFER',
  outbound_mci      INTEGER              NOT NULL DEFAULT 0
                      CHECK (outbound_mci BETWEEN -100 AND 100),
  inbound_mci       INTEGER
                      CHECK (inbound_mci BETWEEN -100 AND 100),
  capacity_label    VARCHAR(30)          NOT NULL DEFAULT 'Neutral',
  lt_ratio          DECIMAL(4,2),                       -- load-to-truck ratio
  rejection_rate    DECIMAL(5,2),                       -- OTRI %
  data_source       VARCHAR(20)          DEFAULT 'MANUAL',  -- MANUAL, DAT_API, SCREENSHOT
  valid_date        DATE                 NOT NULL DEFAULT CURRENT_DATE,
  updated_at        TIMESTAMP            DEFAULT NOW(),
  UNIQUE (city, state, equipment_type, valid_date)
);

-- Composite index: primary lookup path (city/state/type → latest snapshot)
CREATE INDEX IF NOT EXISTS idx_market_snapshot_city_state
  ON "MarketSnapshot" (city, state, equipment_type, valid_date DESC);

-- Date-only index: useful for purging old snapshots or bulk date-range queries
CREATE INDEX IF NOT EXISTS idx_market_snapshot_date
  ON "MarketSnapshot" (valid_date DESC);

-- ============================================================
-- SEED: every city × every equipment type in one upsert.
-- To add a new market: add one row to the cities CTE.
-- To add a new equipment type: add one row to the types CTE.
-- ============================================================

WITH cities(city, state) AS (
  VALUES

  -- SOUTH / TEXAS
  ('Dallas',           'TX'),
  ('Houston',          'TX'),
  ('San Antonio',      'TX'),
  ('Fort Worth',       'TX'),
  ('Austin',           'TX'),
  ('El Paso',          'TX'),
  ('Laredo',           'TX'),

  -- SOUTHEAST
  ('Atlanta',          'GA'),
  ('Savannah',         'GA'),
  ('Macon',            'GA'),
  ('Miami',            'FL'),
  ('Tampa',            'FL'),
  ('Orlando',          'FL'),
  ('Jacksonville',     'FL'),
  ('Lakeland',         'FL'),
  ('Charlotte',        'NC'),
  ('Raleigh',          'NC'),
  ('Greensboro',       'NC'),
  ('Columbia',         'SC'),
  ('Greenville',       'SC'),
  ('Birmingham',       'AL'),
  ('Mobile',           'AL'),
  ('Memphis',          'TN'),
  ('Nashville',        'TN'),
  ('Knoxville',        'TN'),
  ('Chattanooga',      'TN'),
  ('New Orleans',      'LA'),
  ('Baton Rouge',      'LA'),
  ('Shreveport',       'LA'),
  ('Jackson',          'MS'),
  ('Little Rock',      'AR'),
  ('Richmond',         'VA'),
  ('Norfolk',          'VA'),
  ('Roanoke',          'VA'),

  -- MIDWEST
  ('Chicago',          'IL'),
  ('Rockford',         'IL'),
  ('Indianapolis',     'IN'),
  ('Fort Wayne',       'IN'),
  ('Columbus',         'OH'),
  ('Cleveland',        'OH'),
  ('Cincinnati',       'OH'),
  ('Toledo',           'OH'),
  ('Detroit',          'MI'),
  ('Grand Rapids',     'MI'),
  ('St Louis',         'MO'),
  ('Kansas City',      'MO'),
  ('Springfield',      'MO'),
  ('Minneapolis',      'MN'),
  ('Duluth',           'MN'),
  ('Milwaukee',        'WI'),
  ('Green Bay',        'WI'),
  ('Omaha',            'NE'),
  ('Lincoln',          'NE'),
  ('Des Moines',       'IA'),
  ('Cedar Rapids',     'IA'),
  ('Louisville',       'KY'),
  ('Lexington',        'KY'),
  ('Wichita',          'KS'),
  ('Sioux Falls',      'SD'),
  ('Fargo',            'ND'),

  -- NORTHEAST
  ('New York',         'NY'),
  ('Buffalo',          'NY'),
  ('Albany',           'NY'),
  ('Philadelphia',     'PA'),
  ('Pittsburgh',       'PA'),
  ('Harrisburg',       'PA'),
  ('Baltimore',        'MD'),
  ('Washington',       'DC'),
  ('Boston',           'MA'),
  ('Hartford',         'CT'),
  ('Providence',       'RI'),
  ('Newark',           'NJ'),

  -- PLAINS / MOUNTAIN
  ('Denver',           'CO'),
  ('Colorado Springs', 'CO'),
  ('Albuquerque',      'NM'),
  ('Phoenix',          'AZ'),
  ('Tucson',           'AZ'),
  ('Salt Lake City',   'UT'),
  ('Las Vegas',        'NV'),
  ('Reno',             'NV'),
  ('Boise',            'ID'),
  ('Billings',         'MT'),
  ('Cheyenne',         'WY'),
  ('Oklahoma City',    'OK'),
  ('Tulsa',            'OK'),

  -- WEST COAST
  ('Los Angeles',      'CA'),
  ('San Diego',        'CA'),
  ('San Francisco',    'CA'),
  ('Sacramento',       'CA'),
  ('Fresno',           'CA'),
  ('Stockton',         'CA'),
  ('Bakersfield',      'CA'),
  ('Portland',         'OR'),
  ('Eugene',           'OR'),
  ('Seattle',          'WA'),
  ('Spokane',          'WA'),
  ('Yakima',           'WA'),

  -- APPALACHIAN / MID-ATLANTIC
  ('Charleston',       'WV'),
  ('Huntington',       'WV')
),
types(equipment_type) AS (
  VALUES ('REEFER'::equipment_type_enum), ('DRY_VAN'::equipment_type_enum), ('FLATBED'::equipment_type_enum)
)
INSERT INTO "MarketSnapshot" (city, state, equipment_type, outbound_mci, capacity_label, data_source, valid_date)
SELECT
  c.city,
  c.state,
  t.equipment_type,
  0,
  'Neutral',
  'MANUAL',
  :valid_date
FROM cities c CROSS JOIN types t
ON CONFLICT (city, state, equipment_type, valid_date) DO UPDATE
  SET outbound_mci   = EXCLUDED.outbound_mci,
      inbound_mci    = EXCLUDED.inbound_mci,
      capacity_label = EXCLUDED.capacity_label,
      lt_ratio       = EXCLUDED.lt_ratio,
      rejection_rate = EXCLUDED.rejection_rate,
      data_source    = EXCLUDED.data_source,
      updated_at     = NOW();

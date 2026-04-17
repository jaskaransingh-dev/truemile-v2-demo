/**
 * geocoder.ts
 *
 * Nominatim OpenStreetMap geocoder with a two-tier cache:
 *   1. In-memory Map — instant lookup within the same process
 *   2. File cache (backend/data/geocode-cache.json) — survives server restarts
 *
 * Only cities not found in either cache trigger a Nominatim HTTP request.
 * Each HTTP request has a 5-second timeout so a slow/unreachable API never
 * blocks the server indefinitely.
 */

import fs   from 'fs';
import path from 'path';
import type { Location } from '../../types/constraint.types';

interface Coords {
  lat: number;
  lon: number;
}

// ---------------------------------------------------------------------------
// File cache — loaded once at module initialisation, written after each hit
// ---------------------------------------------------------------------------

const CACHE_FILE = path.join(__dirname, '../../../data/geocode-cache.json');

const cache = new Map<string, Coords | null>();

// Load persisted cache on startup — skip null entries (legacy transient-failure poison)
try {
  if (fs.existsSync(CACHE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as Record<string, Coords | null>;
    let loaded = 0;
    let purged = 0;
    for (const [k, v] of Object.entries(saved)) {
      if (v != null) {
        cache.set(k, v);
        loaded++;
      } else {
        purged++;
      }
    }
    console.log(`[geocoder] Loaded ${loaded} entries from disk cache, purged ${purged} stale null entries`);
    if (purged > 0) persistCache();
  }
} catch {
  console.warn('[geocoder] Could not load cache file — starting with empty cache');
}

function persistCache(): void {
  try {
    const obj = Object.fromEntries(cache);
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2));
  } catch {
    console.warn('[geocoder] Could not write cache file');
  }
}

// ---------------------------------------------------------------------------
// Single-city geocoder
// ---------------------------------------------------------------------------

/**
 * Geocodes a single US city+state via Nominatim.
 * Returns null on API failure, timeout, or when the city is not found.
 * Caches both hits and misses so the same city is never fetched twice.
 */
export async function geocodeCity(city: string, state: string): Promise<Coords | null> {
  const key = `${city.toLowerCase().trim()}_${state.toLowerCase().trim()}`;
  if (cache.has(key)) return cache.get(key)!;

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 5000);

  try {
    const url =
      `https://nominatim.openstreetmap.org/search?` +
      `city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}` +
      `&country=US&format=json&limit=1`;

    const res  = await fetch(url, {
      headers: { 'User-Agent': 'TrueMile-Dispatch/1.0' },
      signal:  controller.signal,
    });
    clearTimeout(timeout);

    const data = (await res.json()) as Array<{ lat: string; lon: string }>;

    if (data.length > 0) {
      const result: Coords = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
      cache.set(key, result);
      persistCache();
      return result;
    }

    // API responded successfully but found no results — city genuinely not found. Cache the miss.
    cache.set(key, null);
    persistCache();
    return null;
  } catch (err) {
    clearTimeout(timeout);
    const timedOut = err instanceof Error && err.name === 'AbortError';
    console.warn(`[geocoder] ${timedOut ? 'Timeout' : 'Error'} geocoding ${city}, ${state}`);
    // Do NOT cache transient failures — next request should retry
    return null;
  }
}

// ---------------------------------------------------------------------------
// Batch pre-geocoder
// ---------------------------------------------------------------------------

/**
 * Geocodes all Location objects that are missing lat/lon coordinates.
 *
 * Algorithm:
 *   Phase 1 — split: separate locations into already-cached vs need-to-fetch
 *   Phase 2 — fetch: geocode each uncached pair in series with 1.1s delay
 *             (Nominatim policy: max 1 req/sec)
 *   Phase 3 — apply: write coords into every matching Location object
 *
 * Mutates Location objects in-place so the sequencer uses real coords
 * without being aware of async geocoding.
 */
export async function pregeocode(locations: Location[]): Promise<void> {
  // Phase 1: split unique pairs into cached vs uncached
  const toFetch  = new Map<string, { city: string; state: string }>();
  let cachedCount = 0;

  for (const loc of locations) {
    if (!loc.city || !loc.state) continue;
    if (loc.lat != null && loc.lon != null) continue;
    const key = `${loc.city.toLowerCase().trim()}_${loc.state.toLowerCase().trim()}`;
    if (cache.has(key)) {
      cachedCount++;
    } else if (!toFetch.has(key)) {
      toFetch.set(key, { city: loc.city, state: loc.state });
    }
  }

  console.log(
    `[geocoder] ${toFetch.size} new cities to fetch, ${cachedCount} already cached`,
  );

  // Phase 2: geocode uncached pairs with rate limiting
  for (const { city, state } of toFetch.values()) {
    const coords = await geocodeCity(city, state);
    console.log(
      `[geocoder] ${city}, ${state} → ` +
      (coords ? `(${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)})` : 'not found'),
    );
    await new Promise<void>((r) => setTimeout(r, 1100));
  }

  // Phase 3: apply cached coords to all location objects (memory cache hit — no HTTP)
  for (const loc of locations) {
    if (!loc.city || !loc.state) continue;
    if (loc.lat != null && loc.lon != null) continue;
    const coords = await geocodeCity(loc.city, loc.state);
    if (coords) {
      loc.lat = coords.lat;
      loc.lon = coords.lon;
    }
  }
}

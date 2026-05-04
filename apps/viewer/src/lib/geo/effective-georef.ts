/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  EntityExtractor,
  extractGeoreferencingOnDemand,
  extractLengthUnitScale,
  type GeoreferenceInfo,
  type IfcDataStore,
  type MapConversion,
  type ProjectedCRS,
} from '@ifc-lite/parser';
import type { CoordinateInfo } from '@ifc-lite/geometry';

export interface GeorefMutationDataLike {
  projectedCRS?: Partial<ProjectedCRS>;
  mapConversion?: Partial<MapConversion>;
}

/** Decimal lat/lon (WGS84) extracted from `IfcSite.RefLatitude/RefLongitude`. */
export interface SiteAnchor {
  lat: number;
  lon: number;
  /** `IfcSite.RefElevation` in metres, or 0 when absent. */
  elevation: number;
  /** Source IfcSite expressId (for debugging). */
  siteExpressId: number;
}

export interface EffectiveGeoreference extends GeoreferenceInfo {
  hasGeoreference: true;
  coordinateInfo?: CoordinateInfo;
  lengthUnitScale: number;
  /**
   * Fallback anchor synthesised from `IfcSite.RefLatitude/RefLongitude/
   * RefElevation` when the model lacks an `IfcMapConversion`. Use this to
   * place the model on a globe by treating the local origin (0, 0, 0) as the
   * site's lat/lon. Mesh vertices are already in metres, so no projection is
   * required.
   */
  siteAnchor?: SiteAnchor;
}

export function inferMapUnitScale(mapUnit: string | undefined, fallback?: number): number | undefined {
  if (!mapUnit) return fallback;
  const normalized = mapUnit.toUpperCase();
  if (normalized.includes('US') && (normalized.includes('SURVEY') || normalized.includes('FTUS'))) {
    return 0.3048006096;
  }
  if (normalized.includes('FOOT') || normalized.includes('FEET')) return 0.3048;
  if (normalized.includes('MILLI')) return 0.001;
  if (normalized.includes('CENTI')) return 0.01;
  if (normalized.includes('DECI')) return 0.1;
  if (normalized.includes('KILO')) return 1000;
  if (normalized.includes('METRE') || normalized.includes('METER')) return 1;
  return fallback;
}

export function getIfcLengthUnitScale(dataStore: IfcDataStore | null | undefined): number {
  if (!dataStore?.source?.length || !dataStore.entityIndex) return 1;
  return extractLengthUnitScale(dataStore.source, dataStore.entityIndex);
}

export function mergeProjectedCRS(
  original: ProjectedCRS | undefined,
  mutations: Partial<ProjectedCRS> | undefined,
  lengthUnitScale: number,
): ProjectedCRS | undefined {
  if (!original && !mutations) return undefined;
  const mapUnit = mutations?.mapUnit ?? original?.mapUnit;
  const mapUnitScale = mutations?.mapUnit !== undefined
    ? inferMapUnitScale(mapUnit, lengthUnitScale)
    : original?.mapUnitScale ?? inferMapUnitScale(mapUnit, undefined);
  return {
    id: original?.id ?? 0,
    name: (mutations?.name ?? original?.name ?? '') as string,
    description: mutations?.description ?? original?.description,
    geodeticDatum: mutations?.geodeticDatum ?? original?.geodeticDatum,
    verticalDatum: mutations?.verticalDatum ?? original?.verticalDatum,
    mapProjection: mutations?.mapProjection ?? original?.mapProjection,
    mapZone: mutations?.mapZone ?? original?.mapZone,
    mapUnit,
    mapUnitScale,
  };
}

export function mergeMapConversion(
  original: MapConversion | undefined,
  mutations: Partial<MapConversion> | undefined,
): MapConversion | undefined {
  if (!original && !mutations) return undefined;
  return {
    id: original?.id ?? 0,
    sourceCRS: original?.sourceCRS ?? 0,
    targetCRS: original?.targetCRS ?? 0,
    eastings: (mutations?.eastings ?? original?.eastings ?? 0) as number,
    northings: (mutations?.northings ?? original?.northings ?? 0) as number,
    orthogonalHeight: (mutations?.orthogonalHeight ?? original?.orthogonalHeight ?? 0) as number,
    xAxisAbscissa: mutations?.xAxisAbscissa ?? original?.xAxisAbscissa,
    xAxisOrdinate: mutations?.xAxisOrdinate ?? original?.xAxisOrdinate,
    scale: mutations?.scale ?? original?.scale,
  };
}

export function getEffectiveGeoreference(
  dataStore: IfcDataStore | null | undefined,
  coordinateInfo?: CoordinateInfo,
  mutations?: GeorefMutationDataLike,
): EffectiveGeoreference | null {
  if (!dataStore) return null;
  const original = extractGeoreferencingOnDemand(dataStore);
  const lengthUnitScale = getIfcLengthUnitScale(dataStore);
  const projectedCRS = mergeProjectedCRS(
    original?.projectedCRS,
    mutations?.projectedCRS,
    lengthUnitScale,
  );
  const rawMapConversion = mergeMapConversion(original?.mapConversion, mutations?.mapConversion);

  // Reject (0, 0, 0) eastings/northings/orthogonalHeight — many authoring
  // tools write a stub IfcMapConversion alongside a CRS without setting the
  // origin, making (0, 0) reproject to a random point in the CRS (e.g.
  // EPSG:2232 (0, 0) → middle of the New Mexico desert). Treat it as
  // "no real conversion" and let the siteAnchor fallback take over.
  const isNullIslandConversion = rawMapConversion
    && (rawMapConversion.eastings ?? 0) === 0
    && (rawMapConversion.northings ?? 0) === 0
    && (rawMapConversion.orthogonalHeight ?? 0) === 0;
  const mapConversion = isNullIslandConversion ? undefined : rawMapConversion;

  // Auto-detect: if no IfcMapConversion is present, fall back to IfcSite
  // RefLatitude/RefLongitude/RefElevation. This catches the common case
  // where a model has only "local" engineering coordinates but does carry
  // an approximate site lat/lon.
  let siteAnchor: SiteAnchor | undefined;
  if (!mapConversion) {
    siteAnchor = extractSiteAnchorFromIfcSite(dataStore) ?? undefined;
  }

  if (!projectedCRS && !mapConversion && !siteAnchor) return null;
  return {
    hasGeoreference: true,
    projectedCRS,
    mapConversion,
    coordinateInfo,
    lengthUnitScale,
    transformMatrix: original?.transformMatrix,
    siteAnchor,
  };
}

// ─── IfcSite RefLat/RefLon/RefElevation auto-detect ────────────────────────

/**
 * IFC stores compound plane angles as `[degrees, minutes, seconds, millionths?]`
 * with each component carrying its own sign in IFC files (negative = S/W).
 * Convert to a signed decimal degree.
 */
function compoundPlaneAngleToDegrees(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  const parts = value.filter((p) => typeof p === 'number') as number[];
  if (parts.length < 2) return null;
  const [deg = 0, min = 0, sec = 0, micro = 0] = parts;
  // Sign is conveyed by the dominant (degree) component; if degrees is 0 use
  // the next non-zero component's sign.
  const sign = deg < 0 || min < 0 || sec < 0 ? -1 : 1;
  const absDeg = Math.abs(deg) + Math.abs(min) / 60 + Math.abs(sec) / 3600 + Math.abs(micro) / 3_600_000_000;
  return sign * absDeg;
}

function extractSiteAnchorFromIfcSite(dataStore: IfcDataStore): SiteAnchor | null {
  if (!dataStore.source?.length || !dataStore.entityIndex) return null;
  const siteIds = dataStore.entityIndex.byType.get('IFCSITE');
  if (!siteIds?.length) return null;

  const extractor = new EntityExtractor(dataStore.source);

  for (const siteId of siteIds) {
    const ref = dataStore.entityIndex.byId.get(siteId);
    if (!ref) continue;
    const entity = extractor.extractEntity(ref);
    if (!entity) continue;
    const attrs = entity.attributes;
    // IfcSite attribute order:
    //   [0] GlobalId, [1] OwnerHistory, [2] Name, [3] Description,
    //   [4] ObjectType, [5] ObjectPlacement, [6] Representation,
    //   [7] LongName, [8] CompositionType,
    //   [9] RefLatitude (CompoundPlaneAngle),
    //   [10] RefLongitude (CompoundPlaneAngle),
    //   [11] RefElevation (Length), [12] LandTitleNumber, [13] SiteAddress
    const lat = compoundPlaneAngleToDegrees(attrs[9]);
    const lon = compoundPlaneAngleToDegrees(attrs[10]);
    if (lat === null || lon === null) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    if (lat === 0 && lon === 0) continue; // null-island sentinel — treat as missing

    const elevationRaw = attrs[11];
    const elevation = typeof elevationRaw === 'number' ? elevationRaw : 0;

    return { lat, lon, elevation, siteExpressId: siteId };
  }
  return null;
}

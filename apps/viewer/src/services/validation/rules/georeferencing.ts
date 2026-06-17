/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ValidationRule, RuleResult } from '../types';

const FINITE = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const mapConversionRule: ValidationRule = {
  id: 'geo.mapconversion-present',
  category: 'georeferencing',
  title: 'IfcMapConversion',
  description: 'IFC4/IFC4X3 models should declare an IfcMapConversion with numeric Eastings, Northings, OrthogonalHeight, and X-axis rotation components.',
  appliesTo: (ctx) => ctx.schemaVersion === 'IFC4' || ctx.schemaVersion === 'IFC4X3',
  run: (ctx) => {
    const ids = ctx.getIdsOfType('IFCMAPCONVERSION');
    if (ids.length === 0) {
      return [{
        ruleId: 'geo.mapconversion-present',
        severity: 'error',
        message: 'No IfcMapConversion found. Real-world georeferencing is required for ArcGIS / GIS integration.',
      }];
    }
    const results: RuleResult[] = [];
    for (const id of ids) {
      const e = ctx.getEntity(id);
      if (!e) {
        results.push({ ruleId: 'geo.mapconversion-present', severity: 'warning', message: `IfcMapConversion #${id} could not be extracted.`, entityId: id, entityType: 'IfcMapConversion' });
        continue;
      }
      const [_src, _tgt, eastings, northings, height, xAbs, xOrd] = e.attributes;
      const problems: string[] = [];
      if (!FINITE(eastings)) problems.push('Eastings missing/invalid');
      if (!FINITE(northings)) problems.push('Northings missing/invalid');
      if (!FINITE(height)) problems.push('OrthogonalHeight missing/invalid');
      if (!FINITE(xAbs)) problems.push('XAxisAbscissa missing');
      if (!FINITE(xOrd)) problems.push('XAxisOrdinate missing');
      results.push({
        ruleId: 'geo.mapconversion-present',
        severity: problems.length ? 'warning' : 'pass',
        message: problems.length
          ? `IfcMapConversion #${id}: ${problems.join(', ')}.`
          : `IfcMapConversion #${id}: Eastings=${eastings}, Northings=${northings}, Height=${height}.`,
        entityId: id,
        entityType: 'IfcMapConversion',
        details: { eastings, northings, orthogonalHeight: height, xAxisAbscissa: xAbs, xAxisOrdinate: xOrd },
      });
    }
    return results;
  },
};

const projectedCrsRule: ValidationRule = {
  id: 'geo.projectedcrs-present',
  category: 'georeferencing',
  title: 'IfcProjectedCRS',
  description: 'IFC4/IFC4X3 models should declare an IfcProjectedCRS with a populated Name (EPSG code recommended).',
  appliesTo: (ctx) => ctx.schemaVersion === 'IFC4' || ctx.schemaVersion === 'IFC4X3',
  run: (ctx) => {
    const ids = ctx.getIdsOfType('IFCPROJECTEDCRS');
    if (ids.length === 0) {
      return [{
        ruleId: 'geo.projectedcrs-present',
        severity: 'warning',
        message: 'No IfcProjectedCRS found. Target coordinate reference system is undefined.',
      }];
    }
    const results: RuleResult[] = [];
    for (const id of ids) {
      const e = ctx.getEntity(id);
      if (!e) continue;
      const name = e.attributes[0];
      const ok = typeof name === 'string' && name.trim().length > 0;
      results.push({
        ruleId: 'geo.projectedcrs-present',
        severity: ok ? 'pass' : 'warning',
        message: ok ? `IfcProjectedCRS #${id}: ${name}.` : `IfcProjectedCRS #${id} has no Name (EPSG code expected).`,
        entityId: id,
        entityType: 'IfcProjectedCRS',
      });
    }
    return results;
  },
};

const siteCoordinatesRule: ValidationRule = {
  id: 'geo.ifcsite-coordinates',
  category: 'georeferencing',
  title: 'IfcSite RefLatitude / RefLongitude / RefElevation',
  description: 'IFC2X3 models rely on IfcSite RefLatitude/RefLongitude/RefElevation for georeferencing.',
  appliesTo: (ctx) => ctx.schemaVersion === 'IFC2X3',
  run: (ctx) => {
    const ids = ctx.getIdsOfType('IFCSITE');
    if (ids.length === 0) {
      return [{ ruleId: 'geo.ifcsite-coordinates', severity: 'error', message: 'No IfcSite found.' }];
    }
    const results: RuleResult[] = [];
    for (const id of ids) {
      const e = ctx.getEntity(id);
      if (!e) continue;
      // IfcSite (IFC2x3): [0]GlobalId [1]OwnerHistory [2]Name [3]Description [4]ObjectType
      // [5]ObjectPlacement [6]Representation [7]LongName [8]CompositionType
      // [9]RefLatitude [10]RefLongitude [11]RefElevation [12]LandTitleNumber [13]SiteAddress
      const lat = e.attributes[9];
      const lon = e.attributes[10];
      const elev = e.attributes[11];
      const flatten = (v: unknown): number | null => {
        if (FINITE(v)) return v;
        if (Array.isArray(v)) {
          // DMS components: [deg, min, sec, [ms]] → decimal degrees
          const nums = v.filter(FINITE) as number[];
          if (!nums.length) return null;
          return nums[0] + (nums[1] ?? 0) / 60 + (nums[2] ?? 0) / 3600 + (nums[3] ?? 0) / 3.6e6;
        }
        return null;
      };
      const latVal = flatten(lat);
      const lonVal = flatten(lon);
      const problems: string[] = [];
      if (latVal == null) problems.push('RefLatitude missing');
      if (lonVal == null) problems.push('RefLongitude missing');
      if (!FINITE(elev)) problems.push('RefElevation missing');
      const isPlaceholder = latVal === 0 && lonVal === 0;
      let severity: 'pass' | 'warning' = problems.length || isPlaceholder ? 'warning' : 'pass';
      let message: string;
      if (problems.length) {
        message = `IfcSite #${id}: ${problems.join(', ')}.`;
      } else if (isPlaceholder) {
        message = `IfcSite #${id}: RefLatitude/RefLongitude are both 0 (placeholder values).`;
      } else {
        message = `IfcSite #${id}: lat=${latVal?.toFixed(6)}, lon=${lonVal?.toFixed(6)}, elev=${elev}.`;
      }
      results.push({ ruleId: 'geo.ifcsite-coordinates', severity, message, entityId: id, entityType: 'IfcSite', details: { latitude: latVal, longitude: lonVal, elevation: elev } });
    }
    return results;
  },
};

export const GEOREFERENCING_RULES: ValidationRule[] = [
  mapConversionRule,
  projectedCrsRule,
  siteCoordinatesRule,
];

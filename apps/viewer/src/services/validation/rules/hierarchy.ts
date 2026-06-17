/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ValidationRule, RuleContext, RuleResult } from '../types';
import type { IfcAttributeValue } from '@ifc-lite/parser';

const BUILDING_ELEMENT_TYPES_IFC4 = [
  'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCSLAB', 'IFCBEAM', 'IFCCOLUMN', 'IFCDOOR', 'IFCWINDOW',
  'IFCROOF', 'IFCSTAIR', 'IFCSTAIRFLIGHT', 'IFCRAMP', 'IFCRAMPFLIGHT', 'IFCRAILING', 'IFCCURTAINWALL',
  'IFCPLATE', 'IFCMEMBER', 'IFCBUILDINGELEMENTPROXY', 'IFCFOOTING', 'IFCPILE', 'IFCCOVERING',
  'IFCCHIMNEY', 'IFCSHADINGDEVICE',
];

const ORPHAN_REPORT_CAP = 100;

function asNumberArray(v: IfcAttributeValue | undefined): number[] {
  if (v == null) return [];
  if (typeof v === 'number') return [v];
  if (Array.isArray(v)) {
    const out: number[] = [];
    for (const x of v) if (typeof x === 'number') out.push(x);
    return out;
  }
  return [];
}

function asNumber(v: IfcAttributeValue | undefined): number | null {
  return typeof v === 'number' ? v : null;
}

function buildContainmentMaps(ctx: RuleContext): {
  aggregatesParentOf: Map<number, number>;
  containedParentOf: Map<number, number>;
} {
  const aggregatesParentOf = new Map<number, number>();
  const containedParentOf = new Map<number, number>();

  for (const id of ctx.getIdsOfType('IFCRELAGGREGATES')) {
    const e = ctx.getEntity(id);
    if (!e) continue;
    const parent = asNumber(e.attributes[4]);
    const children = asNumberArray(e.attributes[5]);
    if (parent == null) continue;
    for (const c of children) aggregatesParentOf.set(c, parent);
  }

  for (const id of ctx.getIdsOfType('IFCRELCONTAINEDINSPATIALSTRUCTURE')) {
    const e = ctx.getEntity(id);
    if (!e) continue;
    const elements = asNumberArray(e.attributes[4]);
    const structure = asNumber(e.attributes[5]);
    if (structure == null) continue;
    for (const el of elements) containedParentOf.set(el, structure);
  }

  return { aggregatesParentOf, containedParentOf };
}

const containmentChainRule: ValidationRule = {
  id: 'hier.containment-chain',
  category: 'hierarchy',
  title: 'Spatial containment chain',
  description: 'IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey must be reachable through IfcRelAggregates.',
  run: (ctx) => {
    const { aggregatesParentOf } = buildContainmentMaps(ctx);
    const results: RuleResult[] = [];

    const projects = ctx.getIdsOfType('IFCPROJECT');
    const sites = ctx.getIdsOfType('IFCSITE');
    const buildings = ctx.getIdsOfType('IFCBUILDING');
    const storeys = ctx.getIdsOfType('IFCBUILDINGSTOREY');

    const check = (
      child: number,
      childLabel: string,
      expectedParents: number[],
      parentLabel: string,
    ) => {
      const parent = aggregatesParentOf.get(child);
      if (parent == null) {
        results.push({
          ruleId: 'hier.containment-chain',
          severity: 'error',
          message: `${childLabel} #${child} has no parent in IfcRelAggregates (expected ${parentLabel}).`,
          entityId: child,
          entityType: childLabel,
        });
        return;
      }
      if (!expectedParents.includes(parent)) {
        results.push({
          ruleId: 'hier.containment-chain',
          severity: 'error',
          message: `${childLabel} #${child} parent #${parent} is not a ${parentLabel}.`,
          entityId: child,
          entityType: childLabel,
        });
      }
    };

    if (projects.length === 0) {
      results.push({ ruleId: 'hier.containment-chain', severity: 'error', message: 'No IfcProject — spatial chain cannot start.' });
      return results;
    }

    for (const s of sites) check(s, 'IfcSite', projects, 'IfcProject');
    for (const b of buildings) check(b, 'IfcBuilding', sites, 'IfcSite');
    for (const st of storeys) check(st, 'IfcBuildingStorey', buildings, 'IfcBuilding');

    if (results.length === 0) {
      results.push({
        ruleId: 'hier.containment-chain',
        severity: 'pass',
        message: `Spatial containment chain intact (${projects.length} project, ${sites.length} site(s), ${buildings.length} building(s), ${storeys.length} storey(s)).`,
      });
    }
    return results;
  },
};

const orphanElementsRule: ValidationRule = {
  id: 'hier.orphan-elements',
  category: 'hierarchy',
  title: 'Orphan building elements',
  description: 'Every IfcBuildingElement should be contained in a spatial structure or aggregated under one.',
  run: (ctx) => {
    const { aggregatesParentOf, containedParentOf } = buildContainmentMaps(ctx);
    const orphans: number[] = [];
    let totalElements = 0;
    const sample: RuleResult[] = [];

    for (const type of BUILDING_ELEMENT_TYPES_IFC4) {
      const ids = ctx.getIdsOfType(type);
      for (const id of ids) {
        totalElements++;
        if (!aggregatesParentOf.has(id) && !containedParentOf.has(id)) {
          orphans.push(id);
          if (sample.length < ORPHAN_REPORT_CAP) {
            sample.push({
              ruleId: 'hier.orphan-elements',
              severity: 'warning',
              message: `${type} #${id} has no spatial parent.`,
              entityId: id,
              entityType: type,
            });
          }
        }
      }
    }

    if (orphans.length === 0) {
      return [{
        ruleId: 'hier.orphan-elements',
        severity: 'pass',
        message: `All ${totalElements} building element(s) are contained in the spatial structure.`,
      }];
    }

    const summary: RuleResult = {
      ruleId: 'hier.orphan-elements',
      severity: 'warning',
      message: `${orphans.length} of ${totalElements} building element(s) are orphaned${orphans.length > ORPHAN_REPORT_CAP ? ` (showing first ${ORPHAN_REPORT_CAP})` : ''}.`,
      details: { orphanCount: orphans.length, totalElements },
    };
    return [summary, ...sample];
  },
};

export const HIERARCHY_RULES: ValidationRule[] = [
  containmentChainRule,
  orphanElementsRule,
];

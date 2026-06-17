/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ValidationRule, RuleResult } from '../types';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

const schemaVersionRule: ValidationRule = {
  id: 'schema.version-detected',
  category: 'schema',
  title: 'Schema version',
  description: 'Records the detected IFC schema version.',
  run: (ctx) => {
    const known = ['IFC2X3', 'IFC4', 'IFC4X3', 'IFC5'];
    if (!ctx.schemaVersion) {
      return [{ ruleId: 'schema.version-detected', severity: 'error', message: 'No IFC schema version detected.' }];
    }
    const ok = known.includes(ctx.schemaVersion);
    return [{
      ruleId: 'schema.version-detected',
      severity: ok ? 'pass' : 'warning',
      message: ok ? `Detected schema ${ctx.schemaVersion}.` : `Unrecognized schema "${ctx.schemaVersion}".`,
    }];
  },
};

function checkRoot(ctx: Parameters<ValidationRule['run']>[0], typeUpper: string, ruleId: string, label: string): RuleResult[] {
  const ids = ctx.getIdsOfType(typeUpper);
  if (ids.length === 0) {
    return [{ ruleId, severity: 'error', message: `No ${label} entity found.` }];
  }
  const results: RuleResult[] = [];
  for (const id of ids) {
    const e = ctx.getEntity(id);
    if (!e) {
      results.push({ ruleId, severity: 'warning', message: `${label} #${id} could not be extracted.`, entityId: id, entityType: label });
      continue;
    }
    const globalId = e.attributes[0];
    const name = e.attributes[2];
    const problems: string[] = [];
    if (!isNonEmptyString(globalId)) problems.push('GlobalId missing');
    if (!isNonEmptyString(name)) problems.push('Name missing');
    results.push({
      ruleId,
      severity: problems.length ? 'warning' : 'pass',
      message: problems.length ? `${label} #${id}: ${problems.join(', ')}.` : `${label} #${id} has required attributes.`,
      entityId: id,
      entityType: label,
    });
  }
  return results;
}

const ifcProjectRule: ValidationRule = {
  id: 'schema.ifcproject-exists',
  category: 'schema',
  title: 'IfcProject required attributes',
  description: 'Exactly one IfcProject must exist with GlobalId and Name.',
  run: (ctx) => {
    const ids = ctx.getIdsOfType('IFCPROJECT');
    const base = checkRoot(ctx, 'IFCPROJECT', 'schema.ifcproject-exists', 'IfcProject');
    if (ids.length > 1) {
      base.push({
        ruleId: 'schema.ifcproject-exists',
        severity: 'error',
        message: `Expected exactly one IfcProject, found ${ids.length}.`,
      });
    }
    return base;
  },
};

const ifcSiteRule: ValidationRule = {
  id: 'schema.ifcsite-exists',
  category: 'schema',
  title: 'IfcSite required attributes',
  description: 'At least one IfcSite must exist with GlobalId.',
  run: (ctx) => checkRoot(ctx, 'IFCSITE', 'schema.ifcsite-exists', 'IfcSite'),
};

const ifcBuildingRule: ValidationRule = {
  id: 'schema.ifcbuilding-exists',
  category: 'schema',
  title: 'IfcBuilding required attributes',
  description: 'At least one IfcBuilding must exist with GlobalId.',
  run: (ctx) => checkRoot(ctx, 'IFCBUILDING', 'schema.ifcbuilding-exists', 'IfcBuilding'),
};

export const SCHEMA_RULES: ValidationRule[] = [
  schemaVersionRule,
  ifcProjectRule,
  ifcSiteRule,
  ifcBuildingRule,
];

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { IfcEntity, IfcAttributeValue } from '@ifc-lite/parser';

export type Severity = 'pass' | 'warning' | 'error';

export type RuleCategory = 'schema' | 'georeferencing' | 'hierarchy' | 'mvd';

export interface RuleContext {
  schemaVersion: string;
  entityCount: number;
  /** byType keys are normalized UPPERCASE (e.g. "IFCSITE"). */
  entitiesByType: Map<string, number[]>;
  getEntity: (expressId: number) => IfcEntity | undefined;
  /** Returns expressIds for an entity type. Accepts any case. */
  getIdsOfType: (typeName: string) => number[];
  getAttr: (entity: IfcEntity, index: number) => IfcAttributeValue | undefined;
}

export interface RuleResult {
  ruleId: string;
  severity: Severity;
  message: string;
  entityId?: number;
  entityType?: string;
  details?: Record<string, unknown>;
}

export interface ValidationRule {
  id: string;
  category: RuleCategory;
  title: string;
  description: string;
  appliesTo?: (ctx: RuleContext) => boolean;
  run: (ctx: RuleContext) => RuleResult[] | Promise<RuleResult[]>;
}

export interface ValidationReport {
  generatedAt: string;
  schemaVersion: string;
  entityCount: number;
  ruleResults: RuleResult[];
  summary: { pass: number; warning: number; error: number };
  durationMs: number;
}

export interface ValidationProgress {
  completed: number;
  total: number;
  currentRuleId?: string;
}

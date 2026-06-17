/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Validation engine — async, runs on the main thread with explicit yields
 * between rules so large models don't block the UI.
 *
 * The parser's RelationshipGraph contains methods and is not structured-cloneable,
 * so a Web Worker is impractical for v1. The engine API is shaped so this
 * can be moved into a worker later without changing callers.
 */

import { EntityExtractor, type IfcDataStore, type IfcEntity } from '@ifc-lite/parser';
import type {
  RuleContext,
  RuleResult,
  ValidationProgress,
  ValidationReport,
  ValidationRule,
} from './types';
import { DEFAULT_RULES } from './rules';

export interface RunValidationOptions {
  rules?: ValidationRule[];
  onProgress?: (progress: ValidationProgress) => void;
  /** Yield interval — minimum ms between yields back to the event loop. */
  yieldEveryMs?: number;
}

function buildContext(store: IfcDataStore): RuleContext {
  const extractor = new EntityExtractor(store.source);
  const cache = new Map<number, IfcEntity | undefined>();
  const byId = store.entityIndex.byId;
  const byType = store.entityIndex.byType;

  const getEntity = (id: number): IfcEntity | undefined => {
    if (cache.has(id)) return cache.get(id);
    const ref = byId.get(id);
    if (!ref) {
      cache.set(id, undefined);
      return undefined;
    }
    const e = extractor.extractEntity(ref) as IfcEntity | undefined;
    cache.set(id, e);
    return e;
  };

  return {
    schemaVersion: store.schemaVersion,
    entityCount: store.entityCount,
    entitiesByType: byType,
    getEntity,
    getIdsOfType: (typeName: string) => byType.get(typeName.toUpperCase()) ?? [],
    getAttr: (entity, index) => entity.attributes[index],
  };
}

export async function runValidation(
  store: IfcDataStore,
  options: RunValidationOptions = {},
): Promise<ValidationReport> {
  const rules = options.rules ?? DEFAULT_RULES;
  const onProgress = options.onProgress;
  const start = performance.now();
  const ctx = buildContext(store);

  const applicable = rules.filter((r) => !r.appliesTo || r.appliesTo(ctx));
  const ruleResults: RuleResult[] = [];

  let lastYield = performance.now();
  const yieldEvery = options.yieldEveryMs ?? 16;

  for (let i = 0; i < applicable.length; i++) {
    const rule = applicable[i];
    onProgress?.({ completed: i, total: applicable.length, currentRuleId: rule.id });
    try {
      const out = await rule.run(ctx);
      ruleResults.push(...out);
    } catch (err) {
      ruleResults.push({
        ruleId: rule.id,
        severity: 'error',
        message: `Rule "${rule.id}" threw: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    if (performance.now() - lastYield > yieldEvery) {
      await new Promise((r) => setTimeout(r, 0));
      lastYield = performance.now();
    }
  }
  onProgress?.({ completed: applicable.length, total: applicable.length });

  const summary = { pass: 0, warning: 0, error: 0 };
  for (const r of ruleResults) summary[r.severity]++;

  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: store.schemaVersion,
    entityCount: store.entityCount,
    ruleResults,
    summary,
    durationMs: performance.now() - start,
  };
}

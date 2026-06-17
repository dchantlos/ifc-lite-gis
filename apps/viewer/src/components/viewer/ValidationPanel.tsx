/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, X, RefreshCw, Download, FileJson, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { useViewerStore } from '@/store';
import { runValidation } from '@/services/validation/engine';
import { exportValidationJson } from '@/services/validation/exporters/json';
import { exportValidationPdf } from '@/services/validation/exporters/pdf';
import type {
  RuleCategory,
  RuleResult,
  Severity,
  ValidationReport,
} from '@/services/validation/types';

interface ValidationPanelProps {
  onClose?: () => void;
}

const CATEGORY_LABEL: Record<RuleCategory, string> = {
  schema: 'Schema & Syntax',
  georeferencing: 'Geolocation & Georeferencing',
  hierarchy: 'Structural & Relationship',
  mvd: 'MVD',
};

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, pass: 2 };

function SeverityIcon({ severity }: { severity: Severity }) {
  if (severity === 'pass') return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" aria-hidden />;
  if (severity === 'warning') return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" aria-hidden />;
  return <XCircle className="h-4 w-4 text-red-500 shrink-0" aria-hidden />;
}

function groupByCategory(results: RuleResult[], rulesById: Map<string, RuleCategory>): Map<RuleCategory, RuleResult[]> {
  const out = new Map<RuleCategory, RuleResult[]>();
  for (const r of results) {
    const cat = rulesById.get(r.ruleId) ?? 'schema';
    const arr = out.get(cat) ?? [];
    arr.push(r);
    out.set(cat, arr);
  }
  for (const [, arr] of out) {
    arr.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  }
  return out;
}

export function ValidationPanel({ onClose }: ValidationPanelProps) {
  const ifcDataStore = useViewerStore((s) => s.ifcDataStore);
  const report = useViewerStore((s) => s.validationReport);
  const running = useViewerStore((s) => s.validationRunning);
  const progress = useViewerStore((s) => s.validationProgress);
  const error = useViewerStore((s) => s.validationError);
  const setReport = useViewerStore((s) => s.setValidationReport);
  const setRunning = useViewerStore((s) => s.setValidationRunning);
  const setProgress = useViewerStore((s) => s.setValidationProgress);
  const setError = useViewerStore((s) => s.setValidationError);
  const setSelectedEntityId = useViewerStore((s) => s.setSelectedEntityId);

  const [expanded, setExpanded] = useState<Record<RuleCategory, boolean>>({
    schema: true,
    georeferencing: true,
    hierarchy: true,
    mvd: true,
  });

  const run = useCallback(async () => {
    if (!ifcDataStore) {
      setError('Load an IFC model first.');
      return;
    }
    setError(null);
    setRunning(true);
    setProgress({ completed: 0, total: 0 });
    try {
      const result = await runValidation(ifcDataStore, {
        onProgress: (p) => setProgress(p),
      });
      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }, [ifcDataStore, setError, setRunning, setProgress, setReport]);

  // Auto-run on first open when a model is present and no report exists
  useEffect(() => {
    if (ifcDataStore && !report && !running) {
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rulesById = useMemo(() => {
    const m = new Map<string, RuleCategory>();
    if (report) {
      // Infer category from rule id prefix (rule id encodes category-ish prefix)
      for (const r of report.ruleResults) {
        if (r.ruleId.startsWith('schema.')) m.set(r.ruleId, 'schema');
        else if (r.ruleId.startsWith('geo.')) m.set(r.ruleId, 'georeferencing');
        else if (r.ruleId.startsWith('hier.')) m.set(r.ruleId, 'hierarchy');
        else m.set(r.ruleId, 'mvd');
      }
    }
    return m;
  }, [report]);

  const grouped = useMemo(
    () => (report ? groupByCategory(report.ruleResults, rulesById) : new Map<RuleCategory, RuleResult[]>()),
    [report, rulesById],
  );

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          <span className="font-medium text-sm">Validation</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={!ifcDataStore || running}
            onClick={() => void run()}
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${running ? 'animate-spin' : ''}`} />
            {report ? 'Re-run' : 'Run'}
          </Button>

          {report && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                  <Download className="h-3 w-3 mr-1" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportValidationJson(report)}>
                  <FileJson className="h-3 w-3 mr-2" /> JSON
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void exportValidationPdf(report)}>
                  <FileText className="h-3 w-3 mr-2" /> PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {onClose && (
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!ifcDataStore && !error && (
        <div className="flex-1 flex items-center justify-center p-6 text-sm text-muted-foreground text-center">
          Load an IFC model to run validation.
        </div>
      )}

      {/* Progress */}
      {running && progress && (
        <div className="p-3 border-b">
          <div className="text-xs text-muted-foreground mb-1">
            Running rule {progress.completed} / {progress.total}{progress.currentRuleId ? ` · ${progress.currentRuleId}` : ''}
          </div>
          <div className="h-1.5 bg-muted rounded overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: progress.total ? `${(progress.completed / progress.total) * 100}%` : '0%' }}
            />
          </div>
        </div>
      )}

      {/* Report */}
      {report && (
        <div className="flex-1 overflow-auto">
          <SummaryBar report={report} />
          <div className="p-3 space-y-3">
            {(['schema', 'georeferencing', 'hierarchy', 'mvd'] as RuleCategory[]).map((cat) => {
              const items = grouped.get(cat);
              if (!items || items.length === 0) return null;
              const counts = items.reduce(
                (acc, r) => {
                  acc[r.severity]++;
                  return acc;
                },
                { pass: 0, warning: 0, error: 0 } as Record<Severity, number>,
              );
              return (
                <div key={cat} className="border rounded">
                  <button
                    type="button"
                    onClick={() => setExpanded((p) => ({ ...p, [cat]: !p[cat] }))}
                    className="w-full flex items-center gap-2 p-2 text-left hover:bg-accent"
                  >
                    {expanded[cat] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <span className="font-medium text-sm flex-1">{CATEGORY_LABEL[cat]}</span>
                    <span className="text-xs text-muted-foreground">
                      <span className="text-red-600">{counts.error}</span>
                      {' · '}
                      <span className="text-yellow-600">{counts.warning}</span>
                      {' · '}
                      <span className="text-green-600">{counts.pass}</span>
                    </span>
                  </button>
                  {expanded[cat] && (
                    <ul className="divide-y">
                      {items.map((r, idx) => (
                        <li key={idx} className="p-2 flex items-start gap-2">
                          <SeverityIcon severity={r.severity} />
                          <div className="flex-1 min-w-0 text-sm">
                            <div className="font-mono text-[10px] text-muted-foreground">{r.ruleId}</div>
                            <div>{r.message}</div>
                          </div>
                          {r.entityId != null && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs shrink-0"
                              onClick={() => setSelectedEntityId(r.entityId!)}
                            >
                              View
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryBar({ report }: { report: ValidationReport }) {
  const { pass, warning, error } = report.summary;
  const total = pass + warning + error;
  return (
    <div className="p-3 border-b">
      <div className="text-xs text-muted-foreground mb-2">
        Schema {report.schemaVersion} · {report.entityCount.toLocaleString()} entities · {report.durationMs.toFixed(0)}ms
      </div>
      <div className="flex gap-2">
        <div className="flex-1 rounded bg-green-50 dark:bg-green-900/20 p-2 text-center">
          <div className="text-lg font-semibold text-green-600">{pass}</div>
          <div className="text-[10px] uppercase text-green-700 dark:text-green-400">Pass</div>
        </div>
        <div className="flex-1 rounded bg-yellow-50 dark:bg-yellow-900/20 p-2 text-center">
          <div className="text-lg font-semibold text-yellow-600">{warning}</div>
          <div className="text-[10px] uppercase text-yellow-700 dark:text-yellow-400">Warn</div>
        </div>
        <div className="flex-1 rounded bg-red-50 dark:bg-red-900/20 p-2 text-center">
          <div className="text-lg font-semibold text-red-600">{error}</div>
          <div className="text-[10px] uppercase text-red-700 dark:text-red-400">Error</div>
        </div>
      </div>
      <div className="mt-2 h-1.5 rounded bg-muted overflow-hidden flex">
        {total > 0 && (
          <>
            <div className="bg-green-500" style={{ width: `${(pass / total) * 100}%` }} />
            <div className="bg-yellow-500" style={{ width: `${(warning / total) * 100}%` }} />
            <div className="bg-red-500" style={{ width: `${(error / total) * 100}%` }} />
          </>
        )}
      </div>
    </div>
  );
}

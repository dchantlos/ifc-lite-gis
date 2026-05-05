/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * AnalysisToolbar — interactive analysis-objects controller for an ArcGIS
 * SceneView.
 *
 * Replaces the Direct/Area measurement widgets with the lower-level
 * `view.analyses` collection so we can add: AreaMeasurement, Dimension,
 * DirectLineMeasurement, LineOfSight, and Viewshed.
 *
 * Each tool: instantiate the analysis, push to `view.analyses`, then call
 * `analysisView.place({ signal })` to start the interactive placement loop.
 * Clicking another tool aborts the previous placement.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Ruler,
  Square,
  GitMerge,
  Eye,
  Mountain,
  X,
} from 'lucide-react';
import type SceneView from '@arcgis/core/views/SceneView';
import AreaMeasurementAnalysis from '@arcgis/core/analysis/AreaMeasurementAnalysis';
import DimensionAnalysis from '@arcgis/core/analysis/DimensionAnalysis';
import DirectLineMeasurementAnalysis from '@arcgis/core/analysis/DirectLineMeasurementAnalysis';
import LineOfSightAnalysis from '@arcgis/core/analysis/LineOfSightAnalysis';
import ViewshedAnalysis from '@arcgis/core/analysis/ViewshedAnalysis';
import * as promiseUtils from '@arcgis/core/core/promiseUtils';

type AnalysisKind = 'area' | 'dimension' | 'distance' | 'lineOfSight' | 'viewshed';

interface ToolDef {
  kind: AnalysisKind;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const TOOLS: readonly ToolDef[] = [
  { kind: 'distance',    label: 'Distance',     Icon: Ruler },
  { kind: 'area',        label: 'Area',         Icon: Square },
  { kind: 'dimension',   label: 'Dimension',    Icon: GitMerge },
  { kind: 'lineOfSight', label: 'Line of Sight', Icon: Eye },
  { kind: 'viewshed',    label: 'Viewshed',     Icon: Mountain },
];

function createAnalysis(kind: AnalysisKind) {
  switch (kind) {
    case 'area':        return new AreaMeasurementAnalysis();
    case 'dimension':   return new DimensionAnalysis();
    case 'distance':    return new DirectLineMeasurementAnalysis();
    case 'lineOfSight': return new LineOfSightAnalysis();
    case 'viewshed':    return new ViewshedAnalysis();
  }
}

export interface AnalysisToolbarProps {
  view: SceneView | null;
  /** Visual size variant. `compact` for inline panels, `default` for fullscreen. */
  size?: 'compact' | 'default';
}

export function AnalysisToolbar({ view, size = 'default' }: AnalysisToolbarProps) {
  const [active, setActive] = useState<AnalysisKind | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stopActive = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setActive(null);
  };

  const startTool = async (kind: AnalysisKind) => {
    if (!view) {
      console.warn('[AnalysisToolbar] no view available');
      return;
    }
    stopActive();

    console.info('[AnalysisToolbar] start', kind);
    const analysis = createAnalysis(kind);
    view.analyses.add(analysis);

    const controller = new AbortController();
    abortRef.current = controller;
    setActive(kind);

    try {
      // The analyses collection holds the union; narrow per-branch so
      // whenAnalysisView<T> picks the right concrete AnalysisView3D type.
      const place = async (signal: AbortSignal): Promise<void> => {
        switch (analysis.declaredClass) {
          case 'esri.analysis.AreaMeasurementAnalysis': {
            const av = await view.whenAnalysisView(analysis as AreaMeasurementAnalysis);
            while (!signal.aborted) await av.place({ signal });
            break;
          }
          case 'esri.analysis.DimensionAnalysis': {
            const av = await view.whenAnalysisView(analysis as DimensionAnalysis);
            while (!signal.aborted) await av.place({ signal });
            break;
          }
          case 'esri.analysis.DirectLineMeasurementAnalysis': {
            const av = await view.whenAnalysisView(analysis as DirectLineMeasurementAnalysis);
            while (!signal.aborted) await av.place({ signal });
            break;
          }
          case 'esri.analysis.LineOfSightAnalysis': {
            const av = await view.whenAnalysisView(analysis as LineOfSightAnalysis);
            while (!signal.aborted) await av.place({ signal });
            break;
          }
          case 'esri.analysis.ViewshedAnalysis': {
            const av = await view.whenAnalysisView(analysis as ViewshedAnalysis);
            while (!signal.aborted) await av.place({ signal });
            break;
          }
          default:
            console.warn('[AnalysisToolbar] unknown analysis class', analysis.declaredClass);
        }
      };
      await place(controller.signal);
    } catch (err) {
      if (!promiseUtils.isAbortError(err)) {
        console.error('[AnalysisToolbar] place failed', err);
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setActive((curr) => (curr === kind ? null : curr));
      }
    }
  };

  const clearAll = () => {
    stopActive();
    if (view) view.analyses.removeAll();
  };

  // Cleanup on unmount.
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const btnSize = size === 'compact' ? 'h-6 px-1.5 text-[10px]' : 'h-8 px-2 text-xs';
  const iconSize = size === 'compact' ? 'h-3 w-3' : 'h-3.5 w-3.5';

  return (
    <div className="flex flex-wrap items-center gap-1 p-1 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm border border-zinc-300 dark:border-zinc-700 rounded shadow-sm">
      {TOOLS.map(({ kind, label, Icon }) => {
        const isActive = active === kind;
        return (
          <button
            key={kind}
            type="button"
            disabled={!view}
            onClick={() => (isActive ? stopActive() : startTool(kind))}
            className={`flex items-center gap-1 ${btnSize} font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              isActive
                ? 'bg-teal-600 text-white border-teal-700'
                : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700'
            }`}
            title={isActive ? `${label} — click to stop` : label}
          >
            <Icon className={iconSize} />
            {size === 'default' && <span>{label}</span>}
          </button>
        );
      })}
      <button
        type="button"
        disabled={!view}
        onClick={clearAll}
        className={`flex items-center gap-1 ${btnSize} font-medium border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-700 dark:hover:text-red-300 hover:border-red-300 dark:hover:border-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ml-auto`}
        title="Clear all analyses"
      >
        <X className={iconSize} />
        {size === 'default' && <span>Clear</span>}
      </button>
    </div>
  );
}

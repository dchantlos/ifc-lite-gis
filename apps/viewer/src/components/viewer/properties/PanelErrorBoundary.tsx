/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * Generic error boundary so a crash in one panel widget doesn't unmount
 * its siblings (e.g. an ArcGIS init failure shouldn't take the whole
 * GeoreferencingPanel down with it).
 */
export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error(`[${this.props.label ?? 'PanelErrorBoundary'}]`, error, info);
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <div className="px-3 py-2 border border-red-300 dark:border-red-800 bg-red-50/40 dark:bg-red-950/20 text-[10px] font-mono text-red-700 dark:text-red-400">
          {this.props.label ?? 'Component'} failed: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

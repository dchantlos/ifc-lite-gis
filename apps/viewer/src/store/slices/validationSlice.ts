/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { StateCreator } from 'zustand';
import type { ValidationProgress, ValidationReport } from '@/services/validation/types';

export interface ValidationSliceState {
  validationPanelVisible: boolean;
  validationReport: ValidationReport | null;
  validationRunning: boolean;
  validationProgress: ValidationProgress | null;
  validationError: string | null;
}

export interface ValidationSlice extends ValidationSliceState {
  setValidationPanelVisible: (visible: boolean) => void;
  toggleValidationPanel: () => void;
  setValidationReport: (report: ValidationReport | null) => void;
  setValidationRunning: (running: boolean) => void;
  setValidationProgress: (progress: ValidationProgress | null) => void;
  setValidationError: (error: string | null) => void;
}

export const createValidationSlice: StateCreator<ValidationSlice, [], [], ValidationSlice> = (set) => ({
  validationPanelVisible: false,
  validationReport: null,
  validationRunning: false,
  validationProgress: null,
  validationError: null,

  setValidationPanelVisible: (visible) => set({ validationPanelVisible: visible }),
  toggleValidationPanel: () => set((s) => ({ validationPanelVisible: !s.validationPanelVisible })),
  setValidationReport: (report) => set({ validationReport: report }),
  setValidationRunning: (running) => set({ validationRunning: running }),
  setValidationProgress: (progress) => set({ validationProgress: progress }),
  setValidationError: (error) => set({ validationError: error }),
});

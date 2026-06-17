/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ValidationReport } from '../types';

const CATEGORY_LABEL: Record<string, string> = {
  schema: 'Schema & Syntax',
  geo: 'Geolocation & Georeferencing',
  hier: 'Structural & Relationship',
  mvd: 'MVD',
};

function categoryFromRuleId(id: string): string {
  const prefix = id.split('.')[0];
  return CATEGORY_LABEL[prefix] ?? prefix;
}

export async function exportValidationPdf(report: ValidationReport, fileName = 'validation-report.pdf'): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  let y = margin;

  const writeLine = (text: string, size = 10, bold = false) => {
    if (y > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    doc.setFontSize(size);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    const lines = doc.splitTextToSize(text, pageWidth - margin * 2);
    for (const line of lines) {
      if (y > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += size + 4;
    }
  };

  writeLine('IFC Validation Report', 18, true);
  writeLine(`Generated: ${report.generatedAt}`, 10);
  writeLine(`Schema: ${report.schemaVersion}  ·  Entities: ${report.entityCount.toLocaleString()}  ·  Duration: ${report.durationMs.toFixed(0)}ms`, 10);
  y += 8;

  writeLine(`Summary — Pass: ${report.summary.pass}   Warning: ${report.summary.warning}   Error: ${report.summary.error}`, 12, true);
  y += 6;

  const grouped = new Map<string, typeof report.ruleResults>();
  for (const r of report.ruleResults) {
    const cat = categoryFromRuleId(r.ruleId);
    const arr = grouped.get(cat) ?? [];
    arr.push(r);
    grouped.set(cat, arr);
  }

  const sevTag = (s: string) => (s === 'error' ? '[ERROR]' : s === 'warning' ? '[WARN] ' : '[PASS] ');

  for (const [cat, items] of grouped) {
    y += 6;
    writeLine(cat, 13, true);
    for (const r of items) {
      const ent = r.entityId != null ? `  (#${r.entityId}${r.entityType ? ` ${r.entityType}` : ''})` : '';
      writeLine(`${sevTag(r.severity)} ${r.ruleId}${ent} — ${r.message}`, 9);
    }
  }

  doc.save(fileName);
}

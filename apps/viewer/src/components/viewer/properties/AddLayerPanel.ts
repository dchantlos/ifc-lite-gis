/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * AddLayerPanel — a minimal HTMLElement panel for adding layers to a
 * SceneView at runtime. Supports:
 *   1. ArcGIS service / portal item URL (auto-detects type via
 *      Layer.fromArcGISServerUrl or Layer.fromPortalItem).
 *   2. ArcGIS Online portal item id.
 *
 * Mounted into an Expand widget so it lives alongside the other
 * top-right tools. Plain DOM (not a React component) because Expand
 * only accepts HTMLElements / esri Widget instances.
 */

import type SceneView from '@arcgis/core/views/SceneView';
import Layer from '@arcgis/core/layers/Layer';
import PortalItem from '@arcgis/core/portal/PortalItem';

export function createAddLayerPanel(view: SceneView): HTMLElement {
  const root = document.createElement('div');
  root.style.cssText = [
    'background: white',
    'padding: 12px',
    'min-width: 280px',
    'font-family: "Avenir Next", system-ui, sans-serif',
    'font-size: 12px',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'Add layer';
  title.style.cssText = 'font-weight: 600; margin-bottom: 8px;';
  root.appendChild(title);

  const help = document.createElement('div');
  help.textContent = 'Paste an ArcGIS service URL or AGOL item id:';
  help.style.cssText = 'color: #555; margin-bottom: 6px;';
  root.appendChild(help);

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'https://services.../FeatureServer/0  or  itemId';
  input.style.cssText = [
    'width: 100%',
    'padding: 6px 8px',
    'border: 1px solid #ccc',
    'border-radius: 3px',
    'box-sizing: border-box',
    'margin-bottom: 6px',
  ].join(';');
  root.appendChild(input);

  const button = document.createElement('button');
  button.textContent = 'Add layer';
  button.style.cssText = [
    'width: 100%',
    'padding: 6px 8px',
    'background: #0079c1',
    'color: white',
    'border: none',
    'border-radius: 3px',
    'cursor: pointer',
    'font-weight: 600',
  ].join(';');
  root.appendChild(button);

  const status = document.createElement('div');
  status.style.cssText = 'margin-top: 8px; min-height: 16px; color: #555;';
  root.appendChild(status);

  const setStatus = (text: string, isError = false) => {
    status.textContent = text;
    status.style.color = isError ? '#c00' : '#555';
  };

  const tryAdd = async () => {
    const value = input.value.trim();
    if (!value) {
      setStatus('Enter a URL or item id.', true);
      return;
    }
    button.disabled = true;
    setStatus('Loading…');
    try {
      let layer: Layer;
      if (/^https?:\/\//i.test(value)) {
        layer = await Layer.fromArcGISServerUrl({ url: value });
      } else {
        // Portal item id (32 hex chars) — load via PortalItem.
        layer = await Layer.fromPortalItem({
          portalItem: new PortalItem({ id: value }),
        });
      }
      view.map.add(layer);
      setStatus(`Added: ${layer.title || layer.id}`);
      input.value = '';
      // Zoom to the new layer if it has an extent.
      try {
        await layer.when();
        const extent = (layer as unknown as { fullExtent?: __esri.Extent }).fullExtent;
        if (extent) view.goTo(extent).catch(() => { /* ignore */ });
      } catch (err) {
        console.warn('[AddLayerPanel] zoom-to-layer failed', err);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[AddLayerPanel] add layer failed', err);
      setStatus(`Failed: ${msg}`, true);
    } finally {
      button.disabled = false;
    }
  };

  button.addEventListener('click', tryAdd);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') tryAdd();
  });

  return root;
}

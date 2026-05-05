/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ArcgisSceneViewerPage — fullscreen ArcGIS SceneView at route `/scene-viewer`.
 *
 * Receives the merged-IFC GLB via window.postMessage from the opener tab
 * and renders it as a `mesh-3d` Graphic on a topographic 3D basemap.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

import WebScene from '@arcgis/core/WebScene';
import SceneView from '@arcgis/core/views/SceneView';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Mesh from '@arcgis/core/geometry/Mesh';
import SpatialReference from '@arcgis/core/geometry/SpatialReference';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';
import PortalItem from '@arcgis/core/portal/PortalItem';
import LayerList from '@arcgis/core/widgets/LayerList';
import Expand from '@arcgis/core/widgets/Expand';
import Daylight from '@arcgis/core/widgets/Daylight';
import BasemapGallery from '@arcgis/core/widgets/BasemapGallery';
import Search from '@arcgis/core/widgets/Search';

import { AnalysisToolbar } from './AnalysisToolbar';
import { createAddLayerPanel } from './AddLayerPanel';

interface ScenePayload {
  glb: ArrayBuffer;
  lat: number;
  lon: number;
  orthogonalHeight: number;
  headingDeg: number;
  scale: number;
  /** When true, drop the mesh so its lowest point sits on terrain. */
  clampToGround?: boolean;
}

export function ArcgisSceneViewerPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<SceneView | null>(null);
  const [waiting, setWaiting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readyView, setReadyView] = useState<SceneView | null>(null);

  // Build the SceneView once.
  useEffect(() => {
    if (!containerRef.current) return;

    // Load the curated "IFClite Basemap" WebScene by portal item id. This
    // ships pre-configured Topographic vector tiles + Esri3D_Buildings_v1 +
    // Trees + Places & Labels + Terrain3D ground, all in viewingMode: global
    // (wkid 102100). Letting the SDK load the WebScene by item id mirrors
    // exactly what arcgis.com Scene Viewer renders for the same id.
    const scene = new WebScene({
      portalItem: new PortalItem({ id: '200b728276b34f6db53d787b98f20d14' }),
    });

    const view = new SceneView({
      container: containerRef.current,
      map: scene,
      qualityProfile: 'high',
      environment: {
        lighting: {
          type: 'sun',
          // Default to 11am MST (UTC−7, no DST) → 18:00 UTC. The
          // saved WebScene has a nighttime datetime which would
          // otherwise render the scene dark.
          date: new Date('2026-06-21T18:00:00Z'),
          directShadowsEnabled: true,
        },
      },
    });
    viewRef.current = view;

    let disposed = false;
    view.when(() => {
      if (disposed) return;
      console.info('[SceneViewerPage] view ready', {
        viewingMode: view.viewingMode,
        spatialReferenceWkid: view.spatialReference?.wkid,
        basemap: scene.basemap?.title ?? scene.basemap?.id,
      });

      // Diagnostic: dump every layer's load error and inner layerview
      // create-error reason so we can pinpoint why the I3S buildings/
      // trees/labels sublayers aren't rendering.
      (window as unknown as { __view?: SceneView }).__view = view;
      view.map.allLayers.forEach((layer) => {
        layer.when(() => {
          console.info('[layer ready]', layer.title, {
            type: layer.type,
            wkid: (layer as unknown as { spatialReference?: { wkid?: number } }).spatialReference?.wkid,
            loadStatus: layer.loadStatus,
          });
        }, (err: unknown) => {
          console.error('[layer load FAILED]', layer.title, err);
        });
      });
      view.on('layerview-create-error', (ev) => {
        const err = ev.error as unknown as { name?: string; message?: string; details?: unknown };
        console.error('[layerview-create-error]', ev.layer?.title, {
          name: err?.name,
          message: err?.message,
          details: err?.details,
        });
      });

      const layerList = new LayerList({ view });
      view.ui.add(new Search({ view }), { position: 'top-left', index: 0 });
      view.ui.add(new Expand({ view, content: layerList, expanded: false, expandTooltip: 'Layers' }), 'top-right');
      view.ui.add(new Expand({
        view,
        // Hide the date/time picker by default — the section title in
        // the native viewer is "Sun position by date and time". The
        // shadows + sun lighting toggles remain visible.
        content: new Daylight({ view, visibleElements: { datePicker: false } }),
        expanded: false,
        expandTooltip: 'Daylight',
      }), 'top-right');
      view.ui.add(new Expand({
        view,
        content: new BasemapGallery({ view }),
        expanded: false,
        expandTooltip: 'Basemap gallery',
      }), 'top-right');
      view.ui.add(new Expand({
        view,
        content: createAddLayerPanel(view),
        expanded: false,
        expandIcon: 'plus-square',
        expandTooltip: 'Add layer (URL or item id)',
      }), 'top-right');

      setReadyView(view);

      // Tell the opener we're ready to receive the payload.
      try {
        window.opener?.postMessage({ type: 'ifc-lite:scene-viewer-ready' }, '*');
      } catch {
        /* noop */
      }
    }).catch((err) => {
      if (disposed || err?.name === 'AbortError') return;
      setError(err?.message ?? 'SceneView init failed');
    });

    return () => {
      disposed = true;
      setReadyView(null);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Listen for the GLB payload.
  useEffect(() => {
    const handler = async (ev: MessageEvent) => {
      const data = ev.data;
      if (!data || typeof data !== 'object' || data.type !== 'ifc-lite:scene-payload') return;
      const view = viewRef.current;
      if (!view) return;

      const payload = data.payload as ScenePayload;
      console.info('[SceneViewerPage] payload received', {
        lat: payload.lat,
        lon: payload.lon,
        orthogonalHeight: payload.orthogonalHeight,
        headingDeg: payload.headingDeg,
        scale: payload.scale,
        clampToGround: payload.clampToGround,
        glbBytes: payload.glb?.byteLength,
      });
      let blobUrl: string | null = null;
      try {
        if (!Number.isFinite(payload.lat) || !Number.isFinite(payload.lon)) {
          throw new Error(
            `Invalid anchor lat/lon (lat=${payload.lat}, lon=${payload.lon}). ` +
            `The IFC may not be georeferenced.`,
          );
        }
        const anchorWGS84 = new Point({
          longitude: payload.lon,
          latitude: payload.lat,
          z: payload.orthogonalHeight ?? 0,
          spatialReference: SpatialReference.WGS84,
        });
        // The view's SR comes from the basemap (e.g. topo-3d is Web
        // Mercator / wkid 102100). Mesh geometry does NOT auto-reproject,
        // so a WGS84 mesh is silently rejected with "incompatible spatial
        // reference and will not render". Match the view's SR up front.
        const viewSR = view.spatialReference ?? SpatialReference.WGS84;
        const anchor = viewSR.isWebMercator
          ? (webMercatorUtils.geographicToWebMercator(anchorWGS84) as Point)
          : anchorWGS84;
        // geographicToWebMercator drops the z; restore it.
        if (viewSR.isWebMercator) {
          anchor.z = anchorWGS84.z;
        }

        const blob = new Blob([payload.glb], { type: 'model/gltf-binary' });
        blobUrl = URL.createObjectURL(blob);
        const mesh = await Mesh.createFromGLTF(anchor, blobUrl);
        await mesh.load();
        console.info('[SceneViewerPage] mesh loaded', {
          extent: mesh.extent ? {
            xmin: mesh.extent.xmin, ymin: mesh.extent.ymin, zmin: mesh.extent.zmin,
            xmax: mesh.extent.xmax, ymax: mesh.extent.ymax, zmax: mesh.extent.zmax,
            sr: mesh.extent.spatialReference?.wkid,
          } : null,
        });

        if (Math.abs(payload.headingDeg) > 1e-6) {
          mesh.rotate(0, 0, payload.headingDeg, { origin: anchor });
        }
        if ((payload.scale ?? 1) !== 1) {
          mesh.scale(payload.scale, { origin: anchor });
        }

        if (payload.clampToGround) {
          try {
            const result: any = await view.map.ground.queryElevation(anchor);
            const groundZ = (result?.geometry?.z as number | undefined) ?? 0;
            const dz = groundZ - anchor.z;
            if (Number.isFinite(dz) && Math.abs(dz) > 1e-3) {
              mesh.offset(0, 0, dz);
            }
          } catch (err) {
            console.warn('[SceneViewerPage] terrain clamp failed', err);
          }
        }

        const graphic = new Graphic({
          geometry: mesh,
          symbol: {
            type: 'mesh-3d',
            symbolLayers: [{ type: 'fill' }],
          } as any,
        });
        console.info('[SceneViewerPage] adding graphic', {
          viewSR: view.spatialReference?.wkid,
          meshSR: mesh.spatialReference?.wkid,
        });
        view.graphics.add(graphic);
        console.info('[SceneViewerPage] graphic added; total graphics:', view.graphics.length);
        setWaiting(false);

        view.goTo({ target: graphic, tilt: 55 }, { duration: 1200, animate: true }).catch((err) => {
          if (err?.name !== 'AbortError') console.warn('[SceneViewerPage] goTo failed', err);
        });
      } catch (err) {
        console.error('[SceneViewerPage] failed to load mesh', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <div className="fixed inset-0 bg-black">
      <div ref={containerRef} className="absolute inset-0" />
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
        <AnalysisToolbar view={readyView} size="default" />
      </div>
      {waiting && !error && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-3 py-2 bg-zinc-900/80 backdrop-blur-sm text-white text-xs font-mono rounded flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Waiting for IFC mesh from opener tab…
        </div>
      )}
      {error && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-3 py-2 bg-red-900/80 text-red-100 text-xs font-mono rounded">
          {error}
        </div>
      )}
    </div>
  );
}

export default ArcgisSceneViewerPage;

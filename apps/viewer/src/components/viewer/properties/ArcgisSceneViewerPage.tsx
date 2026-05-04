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
import ElevationLayer from '@arcgis/core/layers/ElevationLayer';
import SceneLayer from '@arcgis/core/layers/SceneLayer';
import LayerList from '@arcgis/core/widgets/LayerList';
import Expand from '@arcgis/core/widgets/Expand';
import Daylight from '@arcgis/core/widgets/Daylight';
import BasemapGallery from '@arcgis/core/widgets/BasemapGallery';

import { AnalysisToolbar } from './AnalysisToolbar';

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

    // Use the 3D-native topographic basemap so the SceneView runs in global
    // WGS84 mode. The 2D `topo-vector` basemap is Web Mercator and triggers
    // "Graphic has incompatible spatial reference" errors for WGS84 meshes.
    const scene = new WebScene({
      basemap: 'topo-3d',
      ground: {
        layers: [new ElevationLayer({
          url: 'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer',
        })],
      },
      layers: [new SceneLayer({
        url: 'https://basemaps3d.arcgis.com/arcgis/rest/services/Open3D_Buildings_v1/SceneServer',
        title: 'OSM 3D Buildings',
      })],
    });

    const view = new SceneView({
      container: containerRef.current,
      map: scene,
      // Force global WGS84 mode so all layers and graphics share a
      // consistent SR. Without this SceneView occasionally falls into a
      // local/Web Mercator mode that breaks layerviews and rejects WGS84
      // mesh graphics with "incompatible spatial reference".
      viewingMode: 'global',
      spatialReference: SpatialReference.WGS84,
      qualityProfile: 'high',
      environment: {
        lighting: {
          type: 'sun',
          directShadowsEnabled: true,
        },
      },
    });
    viewRef.current = view;

    let disposed = false;
    view.when(() => {
      if (disposed) return;
      const layerList = new LayerList({ view });
      view.ui.add(new Expand({ view, content: layerList, expanded: false, expandTooltip: 'Layers' }), 'top-right');
      view.ui.add(new Expand({
        view,
        content: new Daylight({ view }),
        expanded: false,
        expandTooltip: 'Daylight',
      }), 'top-right');
      view.ui.add(new Expand({
        view,
        content: new BasemapGallery({ view }),
        expanded: false,
        expandTooltip: 'Basemap gallery',
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
      let blobUrl: string | null = null;
      try {
        const anchor = new Point({
          longitude: payload.lon,
          latitude: payload.lat,
          z: payload.orthogonalHeight ?? 0,
          spatialReference: SpatialReference.WGS84,
        });

        const blob = new Blob([payload.glb], { type: 'model/gltf-binary' });
        blobUrl = URL.createObjectURL(blob);
        const mesh = await Mesh.createFromGLTF(anchor, blobUrl);
        await mesh.load();

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
        view.graphics.add(graphic);
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

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ArcgisLocationMap — drop-in replacement for the MapLibre `LocationMap`.
 *
 * Renders a small ArcGIS SceneView (topographic-3d basemap) with the IFC
 * placed as a `mesh-3d` Graphic anchored at its georeferenced lat/lon.
 */

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, MapPinOff } from 'lucide-react';
import type { MapConversion, ProjectedCRS } from '@ifc-lite/parser';
import type { CoordinateInfo, GeometryResult } from '@ifc-lite/geometry';

import WebScene from '@arcgis/core/WebScene';
import SceneView from '@arcgis/core/views/SceneView';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Mesh from '@arcgis/core/geometry/Mesh';
import SpatialReference from '@arcgis/core/geometry/SpatialReference';
import ElevationLayer from '@arcgis/core/layers/ElevationLayer';
import SceneLayer from '@arcgis/core/layers/SceneLayer';

import { buildMergedGLB } from '@/lib/geo/buildMergedGLB';
import { reprojectToLatLon } from '@/lib/geo/reproject';

export interface PickedPosition {
  easting: number;
  northing: number;
  terrainHeight: number | null;
}

export interface ArcgisLocationMapProps {
  mapConversion?: MapConversion;
  projectedCRS?: ProjectedCRS;
  coordinateInfo?: CoordinateInfo;
  geometryResult?: GeometryResult | null;
  lengthUnitScale?: number;
  editable?: boolean;
  onApplyPosition?: (position: PickedPosition) => void;
  /**
   * Fallback anchor when no IfcMapConversion exists. Synthesised from
   * `IfcSite.RefLatitude/RefLongitude/RefElevation`. The mesh origin is
   * placed at this lat/lon with no rotation or scale.
   */
  siteAnchor?: { lat: number; lon: number; elevation: number };
}

type Status = 'idle' | 'loading' | 'ready' | 'error' | 'no-georef';

export function ArcgisLocationMap({
  mapConversion,
  projectedCRS,
  coordinateInfo,
  geometryResult,
  lengthUnitScale = 1,
  editable: _editable,
  onApplyPosition: _onApplyPosition,
  siteAnchor,
}: ArcgisLocationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<SceneView | null>(null);
  const graphicRef = useRef<Graphic | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  // setReadyView is retained as a no-op placeholder so existing call sites
  // (the SceneView 'when' callback) don't need restructuring. The minimap
  // doesn't expose any view-dependent UI of its own.
  const setReadyView = (_v: SceneView | null) => {};

  const hasMapConversion = !!(mapConversion && projectedCRS?.name);
  const hasGeoref = hasMapConversion || !!siteAnchor;

  const [anchorLatLon, setAnchorLatLon] = useState<{ lat: number; lon: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (hasMapConversion && mapConversion && projectedCRS) {
      reprojectToLatLon(mapConversion, projectedCRS, coordinateInfo, lengthUnitScale)
        .then((ll) => {
          if (cancelled) return;
          if (!ll) console.warn('[ArcgisLocationMap] reprojectToLatLon returned null', { projectedCRS });
          setAnchorLatLon(ll);
        })
        .catch((err) => {
          if (!cancelled) {
            console.error('[ArcgisLocationMap] reprojectToLatLon failed', err);
            setAnchorLatLon(null);
          }
        });
      return () => { cancelled = true; };
    }
    if (siteAnchor) {
      setAnchorLatLon({ lat: siteAnchor.lat, lon: siteAnchor.lon });
      return () => { cancelled = true; };
    }
    setAnchorLatLon(null);
    return () => { cancelled = true; };
  }, [hasMapConversion, mapConversion, projectedCRS, coordinateInfo, lengthUnitScale, siteAnchor]);

  // ─── Effect 1: build the SceneView once. ────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !hasGeoref) {
      setStatus(hasGeoref ? 'idle' : 'no-georef');
      return;
    }

    setStatus('loading');
    setError(null);

    let disposed = false;
    let view: SceneView | null = null;
    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    // Defer scene init until the main thread is idle. Heavy IFC parsing /
    // streaming (multi-hundred-MB files take 30+ seconds and block the main
    // thread in chunks) starves ArcGIS's terrain-tile decoder web-workers,
    // causing 'Cannot read properties of null (reading "decode")' errors and
    // sometimes killing the WebGL context. Waiting for an idle window lets
    // the IFC pipeline finish (or at least quiet down) before we spin up
    // ArcGIS's renderer.
    const initScene = () => {
      if (disposed || !containerRef.current) return;

      // Use a 3D-native topographic basemap so the SceneView runs in global
      // WGS84 mode. The 2D `topo-vector` basemap forces the scene into Web
      // Mercator, which then rejects WGS84-anchored IFC mesh graphics with
      // "Graphic ... has incompatible spatial reference and will not render".
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

      view = new SceneView({
        container: containerRef.current,
        map: scene,
        qualityProfile: 'low',
        ui: { components: [] },
        environment: {
          atmosphere: { quality: 'low' },
          lighting: { directShadowsEnabled: false },
        },
      });
      viewRef.current = view;

      view.when(() => {
        if (disposed || !view) return;
        // The minimap intentionally has NO widgets — the right-panel space is
        // tight, and any clicks/Expands tend to mis-fire when the map is only
        // a few hundred pixels tall. The fullscreen `/scene-viewer` page
        // mounts LayerList / Daylight / BasemapGallery / AnalysisToolbar.

        setReadyView(view);
        setStatus('ready');
      }).catch((err) => {
        // AbortError happens when StrictMode unmounts mid-load; ignore it.
        if (disposed || err?.name === 'AbortError') return;
        console.error('[ArcgisLocationMap] view init failed', err);
        setError(err?.message ?? 'SceneView init failed');
        setStatus('error');
      });
    };

    // Wait for an idle window before init; fall back to a 2 s timeout.
    const ric = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined;
    if (ric) {
      idleHandle = ric(initScene, { timeout: 2000 });
    } else {
      timeoutHandle = setTimeout(initScene, 500);
    }

    return () => {
      disposed = true;
      if (idleHandle != null && (window as any).cancelIdleCallback) {
        (window as any).cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle != null) clearTimeout(timeoutHandle);
      setReadyView(null);
      if (view) {
        if (graphicRef.current && view.graphics) view.graphics.remove(graphicRef.current);
        graphicRef.current = null;
        view.destroy();
      }
      viewRef.current = null;
    };
  }, [hasGeoref]);

  // ─── Effect 2: fly to the anchor as soon as we know lat/lon. ────────────
  useEffect(() => {
    const view = viewRef.current;
    if (status !== 'ready' || !view || !anchorLatLon) return;
    view.goTo({
      center: [anchorLatLon.lon, anchorLatLon.lat],
      zoom: 18,
      tilt: 60,
    }, { duration: 1000, animate: true }).catch((err) => {
      if (err?.name !== 'AbortError') {
        console.warn('[ArcgisLocationMap] goTo(anchor) failed', err);
      }
    });
  }, [status, anchorLatLon]);

  // ─── Effect 3: build / refresh the IFC mesh graphic. ────────────────────
  useEffect(() => {
    const view = viewRef.current;
    if (status !== 'ready' || !view || !anchorLatLon) return;
    if (!mapConversion && !siteAnchor) return;

    let cancelled = false;
    let blobUrl: string | null = null;

    (async () => {
      try {
        if (graphicRef.current) {
          view.graphics.remove(graphicRef.current);
          graphicRef.current = null;
        }

        const orthogonalHeight = mapConversion?.orthogonalHeight ?? siteAnchor?.elevation ?? 0;
        const anchor = new Point({
          longitude: anchorLatLon.lon,
          latitude: anchorLatLon.lat,
          z: orthogonalHeight,
          spatialReference: SpatialReference.WGS84,
        });

        // Drop a pin first so something appears even if the GLB load fails.
        const pin = new Graphic({
          geometry: anchor,
          symbol: {
            type: 'point-3d',
            symbolLayers: [{
              type: 'object',
              width: 6, depth: 6, height: 30,
              resource: { primitive: 'cylinder' },
              material: { color: [0, 200, 255, 0.9] },
            }],
          } as any,
        });
        view.graphics.add(pin);
        graphicRef.current = pin;

        const meshes = geometryResult?.meshes;
        if (!meshes || meshes.length === 0) return;

        // Guard against OOM on huge models. A merged GLB stores positions
        // (12 B/vert) + normals (12 B/vert) + indices (~12 B/tri). At 5 M
        // verts that's already ~150 MB, plus ArcGIS allocates again for GPU
        // upload. Above this threshold the tab tends to crash. Leave the pin
        // visible so the user still sees the model's location.
        let totalVerts = 0;
        for (const m of meshes) totalVerts += (m.positions?.length ?? 0) / 3;
        const VERT_BUDGET = 5_000_000;
        if (totalVerts > VERT_BUDGET) {
          console.warn(
            `[ArcgisLocationMap] skipping inline mesh: ${totalVerts.toLocaleString()} verts exceeds ${VERT_BUDGET.toLocaleString()} budget. Showing pin only.`,
          );
          return;
        }

        const glb = buildMergedGLB(meshes);
        const blob = new Blob([glb as BlobPart], { type: 'model/gltf-binary' });
        blobUrl = URL.createObjectURL(blob);

        const mesh = await Mesh.createFromGLTF(anchor, blobUrl);
        if (cancelled) return;
        await mesh.load();

        // MapConversion-based rotation. Site-anchor fallback assumes IFC
        // local +X already points east — there is no rotation info available.
        if (mapConversion) {
          const theta = Math.atan2(
            mapConversion.xAxisOrdinate ?? 0,
            mapConversion.xAxisAbscissa ?? 1,
          );
          const headingDeg = (theta * 180) / Math.PI;
          if (Math.abs(headingDeg) > 1e-6) {
            mesh.rotate(0, 0, headingDeg, { origin: anchor });
          }
        }

        // Always clamp the IFC's local origin (z=0, conventionally finished
        // floor / grade level) to terrain. IFC orthogonalHeight is unreliable
        // across authoring tools (units often wrong, sometimes bogus values).
        // Clamping the origin — not the mesh's lowest point — keeps
        // foundations below grade where they belong.
        try {
          const result: any = await view.map.ground.queryElevation(anchor);
          const groundZ = (result?.geometry?.z as number | undefined) ?? 0;
          const dz = groundZ - anchor.z;
          if (Number.isFinite(dz) && Math.abs(dz) > 1e-3) {
            mesh.offset(0, 0, dz);
          }
        } catch (err) {
          console.warn('[ArcgisLocationMap] terrain clamp failed', err);
        }
        // NOTE: mapConversion.scale is the engineering→projected-CRS scale
        // factor. The mesh vertices are already in metres and the WGS84 anchor
        // places them in real-world metric space, so we must NOT apply the
        // map-conversion scale here (would shrink the building).

        const graphic = new Graphic({
          geometry: mesh,
          symbol: {
            type: 'mesh-3d',
            symbolLayers: [{ type: 'fill' }],
          } as any,
        });

        // Replace the placeholder pin with the actual mesh.
        if (graphicRef.current) view.graphics.remove(graphicRef.current);
        view.graphics.add(graphic);
        graphicRef.current = graphic;

        view.goTo({ target: graphic, tilt: 60 }, { duration: 800, animate: true }).catch((err) => {
          if (err?.name !== 'AbortError') {
            console.warn('[ArcgisLocationMap] goTo(mesh) failed', err);
          }
        });
      } catch (err) {
        if (!cancelled) {
          console.error('[ArcgisLocationMap] mesh load failed', err);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
      }
    })();

    return () => { cancelled = true; };
  }, [status, mapConversion, anchorLatLon, geometryResult, siteAnchor]);

  if (!hasGeoref) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-4 border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 text-xs font-mono">
        <MapPinOff className="h-4 w-4" />
        <span>No georeferencing data</span>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="relative w-full h-64 border border-zinc-300 dark:border-zinc-700 overflow-hidden">
        <div ref={containerRef} className="absolute inset-0" />
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm text-white text-xs font-mono">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Loading 3D scene…
          </div>
        )}
        {status === 'error' && error && (
          <div className="absolute top-2 left-2 right-2 z-10 px-2 py-1 bg-red-900/80 text-red-100 text-[10px] font-mono rounded">
            {error}
          </div>
        )}
      </div>
      {anchorLatLon && (
        <button
          type="button"
          onClick={() => {
            const meshes = geometryResult?.meshes;
            if (!meshes || meshes.length === 0) return;
            let totalVerts = 0;
            for (const m of meshes) totalVerts += (m.positions?.length ?? 0) / 3;
            // Above ~15 M verts the merged GLB approaches 500 MB and the new
            // tab almost always OOMs during decode. Block the open and tell
            // the user.
            const HARD_LIMIT = 15_000_000;
            if (totalVerts > HARD_LIMIT) {
              alert(
                `Model is too large to open in Scene Viewer (${(totalVerts / 1e6).toFixed(1)} M verts, limit ${(HARD_LIMIT / 1e6).toFixed(0)} M).\n\nThe browser cannot transfer a single GLB this large without crashing.`,
              );
              return;
            }
            // Warn for moderately large models that may take a long time / a lot of RAM.
            if (totalVerts > 5_000_000 && !confirm(
              `This model has ${(totalVerts / 1e6).toFixed(1)} M vertices. Opening it in Scene Viewer may take a long time and use a lot of memory. Continue?`,
            )) {
              return;
            }
            const glb = buildMergedGLB(meshes);
            // Detach the underlying ArrayBuffer for transfer to the new tab.
            const buffer = (glb.byteOffset === 0 && glb.byteLength === glb.buffer.byteLength)
              ? glb.buffer
              : glb.slice().buffer;
            let headingDeg = 0;
            if (mapConversion) {
              const theta = Math.atan2(
                mapConversion.xAxisOrdinate ?? 0,
                mapConversion.xAxisAbscissa ?? 1,
              );
              headingDeg = (theta * 180) / Math.PI;
            }
            const payload = {
              glb: buffer,
              lat: anchorLatLon.lat,
              lon: anchorLatLon.lon,
              orthogonalHeight: mapConversion?.orthogonalHeight ?? siteAnchor?.elevation ?? 0,
              headingDeg,
              // mapConversion.scale is engineering→projected scale; mesh is
              // already in metres for WGS84 placement. Send 1.
              scale: 1,
              // IFC orthogonalHeight is unreliable; always clamp on receiver.
              clampToGround: true,
            };
            const sceneViewerUrl = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/scene-viewer`;
            const win = window.open(sceneViewerUrl, '_blank', 'noopener=no');
            if (!win) {
              console.warn('[ArcgisLocationMap] popup blocked');
              return;
            }
            const onMessage = (ev: MessageEvent) => {
              if (ev.source !== win) return;
              if (ev.data?.type !== 'ifc-lite:scene-viewer-ready') return;
              win.postMessage({ type: 'ifc-lite:scene-payload', payload }, '*', [payload.glb]);
              window.removeEventListener('message', onMessage);
            };
            window.addEventListener('message', onMessage);
          }}
          className="flex items-center justify-center gap-1.5 w-full px-2 py-1 text-[10px] font-medium text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/40 hover:bg-teal-100 dark:hover:bg-teal-900/40 border border-teal-300/50 dark:border-teal-700/50 transition-colors"
        >
          <ExternalLink className="h-2.5 w-2.5" />
          Open IFC in Scene Viewer
        </button>
      )}
    </div>
  );
}

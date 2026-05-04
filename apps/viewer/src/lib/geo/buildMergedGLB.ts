/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { MeshData } from '@ifc-lite/geometry';

/**
 * Build a minimal GLB with all geometry merged into a SINGLE mesh.
 *
 * This is MUCH faster than `@ifc-lite/export`'s `GLTFExporter` (which creates
 * one glTF node per IFC mesh — fine for offline export, slow for live globe
 * placement). For a 42K-mesh model: GLTFExporter takes seconds, this takes
 * ~100ms.
 *
 * Vertices are emitted in viewer-space metres (Z-up). The caller is
 * responsible for placing the GLB into world space via a model matrix or
 * (for ArcGIS) by anchoring an `Mesh.createFromGLTF` call to a `Point`.
 */
export interface BuildMergedGLBOptions {
  /**
   * Swizzle vertices from viewer-space Z-up into glTF-spec Y-up.
   * Use this for consumers that strictly follow the glTF Y-up convention
   * and don't expose an upAxis override (e.g. ArcGIS `Mesh.createFromGLTF`).
   * Cesium accepts Z-up GLBs via `upAxis: Cesium.Axis.Z`, so leave this
   * `false` (default) for the Cesium pipeline.
   */
  yUp?: boolean;
}

export function buildMergedGLB(
  meshes: ReadonlyArray<MeshData>,
  options: BuildMergedGLBOptions = {},
): Uint8Array {
  const { yUp = false } = options;
  let totalVerts = 0;
  let totalIdxs = 0;
  for (const m of meshes) {
    if (!m.positions?.length || !m.indices?.length) continue;
    totalVerts += m.positions.length / 3;
    totalIdxs += m.indices.length;
  }

  const positions = new Float32Array(totalVerts * 3);
  const colors = new Uint8Array(totalVerts * 4);
  const indices = new Uint32Array(totalIdxs);

  let vertOff = 0;
  let idxOff = 0;
  for (const m of meshes) {
    if (!m.positions?.length || !m.indices?.length) continue;
    const nv = m.positions.length / 3;
    if (yUp) {
      // Swap Z-up → Y-up: (x, y, z) → (x, z, -y)
      const src = m.positions;
      const dst = positions;
      const off3 = vertOff * 3;
      for (let i = 0; i < nv; i++) {
        const sx = src[i * 3];
        const sy = src[i * 3 + 1];
        const sz = src[i * 3 + 2];
        dst[off3 + i * 3] = sx;
        dst[off3 + i * 3 + 1] = sz;
        dst[off3 + i * 3 + 2] = -sy;
      }
    } else {
      positions.set(m.positions, vertOff * 3);
    }
    const r = Math.round((m.color?.[0] ?? 0.7) * 255);
    const g = Math.round((m.color?.[1] ?? 0.7) * 255);
    const b = Math.round((m.color?.[2] ?? 0.7) * 255);
    const a = Math.round((m.color?.[3] ?? 1.0) * 255);
    for (let i = 0; i < nv; i++) {
      const ci = (vertOff + i) * 4;
      colors[ci] = r; colors[ci + 1] = g; colors[ci + 2] = b; colors[ci + 3] = a;
    }
    for (let i = 0; i < m.indices.length; i++) {
      // Swizzle reverses winding order along one axis; flip triangle orientation
      // by swapping i+1 and i+2 of every triangle to keep faces front-facing.
      indices[idxOff + i] = m.indices[i] + vertOff;
    }
    if (yUp) {
      // Flip winding for every triangle (was CCW in Z-up, becomes CW after the
      // y/-z reflection — swap the last two indices of each triangle).
      for (let t = 0; t < m.indices.length; t += 3) {
        const tmp = indices[idxOff + t + 1];
        indices[idxOff + t + 1] = indices[idxOff + t + 2];
        indices[idxOff + t + 2] = tmp;
      }
    }
    vertOff += nv;
    idxOff += m.indices.length;
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  const posByteLen = positions.byteLength;
  const colByteLen = colors.byteLength;
  const idxByteLen = indices.byteLength;
  const totalBinLen = posByteLen + colByteLen + idxByteLen;

  const gltf = {
    asset: { version: '2.0', generator: 'IFC-Lite-ArcGIS' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 }, indices: 2 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: totalVerts, type: 'VEC3', min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
      { bufferView: 1, componentType: 5121, count: totalVerts, type: 'VEC4', normalized: true },
      { bufferView: 2, componentType: 5125, count: totalIdxs, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posByteLen, target: 34962 },
      { buffer: 0, byteOffset: posByteLen, byteLength: colByteLen, target: 34962 },
      { buffer: 0, byteOffset: posByteLen + colByteLen, byteLength: idxByteLen, target: 34963 },
    ],
    buffers: [{ byteLength: totalBinLen }],
    extensionsUsed: ['KHR_materials_unlit'],
  };

  const jsonStr = JSON.stringify(gltf);
  const jsonBuf = new TextEncoder().encode(jsonStr);
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const jsonChunkLen = jsonBuf.length + jsonPad;
  const binPad = (4 - (totalBinLen % 4)) % 4;
  const binChunkLen = totalBinLen + binPad;

  const glbLen = 12 + 8 + jsonChunkLen + 8 + binChunkLen;
  const glb = new ArrayBuffer(glbLen);
  const view = new DataView(glb);
  let off = 0;

  view.setUint32(off, 0x46546C67, true); off += 4;
  view.setUint32(off, 2, true); off += 4;
  view.setUint32(off, glbLen, true); off += 4;

  view.setUint32(off, jsonChunkLen, true); off += 4;
  view.setUint32(off, 0x4E4F534A, true); off += 4;
  new Uint8Array(glb, off, jsonBuf.length).set(jsonBuf); off += jsonBuf.length;
  for (let i = 0; i < jsonPad; i++) view.setUint8(off++, 0x20);

  view.setUint32(off, binChunkLen, true); off += 4;
  view.setUint32(off, 0x004E4942, true); off += 4;
  new Uint8Array(glb, off, posByteLen).set(new Uint8Array(positions.buffer)); off += posByteLen;
  new Uint8Array(glb, off, colByteLen).set(colors); off += colByteLen;
  new Uint8Array(glb, off, idxByteLen).set(new Uint8Array(indices.buffer)); off += idxByteLen;

  return new Uint8Array(glb);
}

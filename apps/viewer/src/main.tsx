/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Application entry point
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import esriConfig from '@arcgis/core/config';
import { App } from './App';
import './index.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@arcgis/core/assets/esri/themes/light/main.css';

// Pin @arcgis/core's runtime assets to the assets we copy into the
// production build via vite-plugin-static-copy. This ensures the
// asset version matches the installed module version (avoids the
// I3S worker decoder version-mismatch that breaks 3D Buildings on
// the deployed site).
const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, '');
esriConfig.assetsPath = `${baseUrl}/arcgis-assets`;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

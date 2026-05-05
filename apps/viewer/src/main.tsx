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

// Pin @arcgis/core's runtime assets to the Esri CDN so the deployed
// production bundle doesn't depend on its own assets being copied to
// the GitHub Pages base path. Matches the installed @arcgis/core
// major (5.x ≈ JS API 4.34).
esriConfig.assetsPath = 'https://js.arcgis.com/4.34/@arcgis/core/assets';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

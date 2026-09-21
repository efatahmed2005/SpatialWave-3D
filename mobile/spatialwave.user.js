// ==UserScript==
// @name         SpatialWave 3D Mobile Injector
// @namespace    https://github.com/efatahmed2005/SpatialWave-3D
// @version      1.0.0
// @description  Audiophile 3D Binaural & 8D Spatial Audio Engine for Mobile Brave (iOS & Android) & Web Players
// @author       SpatialWave 3D
// @match        *://*.youtube.com/*
// @match        *://*.soundcloud.com/*
// @match        *://*.twitch.tv/*
// @match        *://*.spotify.com/*
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// Include the SpatialWave mobile engine
(function() {
  'use strict';
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/gh/efatahmed2005/SpatialWave-3D@main/mobile/spatialwave-bookmarklet.js';
  // Fallback if offline or local
  script.onerror = function() {
    console.warn('[SpatialWave 3D] Failed to load remote script, using embedded version.');
  };
  document.head.appendChild(script);
})();

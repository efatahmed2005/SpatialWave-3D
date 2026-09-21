/**
 * SpatialWave 3D - Storage Manager
 * Handles persistent configuration and per-domain presets using chrome.storage.local
 */

const DEFAULT_SETTINGS = {
  masterPower: true,
  volume: 1.0,
  targetPreset: 'music',
  headphoneProfile: 'kz_edx_pro',
  mode: 1, // 1 = Orbit 360
  intensity: 0.85,
  speedHz: 0.12,
  distance: 1.4,
  width: 1.2,
  room: 'studio',
  reverbWet: 0.15,
  bassShelf: 0.0,
  trebleShelf: 0.0,
  peqPreamp: -3.5,
  customPeq: null
};

class StorageManager {
  /**
   * Retrieves global settings or merged settings for a specific domain.
   */
  static async getSettings(domain = null) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['globalSettings', 'domainSettings'], (res) => {
          const global = Object.assign({}, DEFAULT_SETTINGS, res.globalSettings || {});
          if (domain && res.domainSettings && res.domainSettings[domain]) {
            resolve(Object.assign({}, global, res.domainSettings[domain]));
          } else {
            resolve(global);
          }
        });
      } else {
        // Fallback for non-extension environments
        try {
          const raw = localStorage.getItem('spatialwave_global');
          resolve(raw ? Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw)) : Object.assign({}, DEFAULT_SETTINGS));
        } catch {
          resolve(Object.assign({}, DEFAULT_SETTINGS));
        }
      }
    });
  }

  /**
   * Saves settings globally or tied to a specific domain.
   */
  static async saveSettings(settings, domain = null) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['globalSettings', 'domainSettings'], (res) => {
          const globalSettings = Object.assign({}, res.globalSettings || {}, settings);
          const domainSettings = res.domainSettings || {};

          if (domain) {
            domainSettings[domain] = Object.assign({}, domainSettings[domain] || {}, settings);
            chrome.storage.local.set({ globalSettings, domainSettings }, () => resolve(true));
          } else {
            chrome.storage.local.set({ globalSettings }, () => resolve(true));
          }
        });
      } else {
        try {
          localStorage.setItem('spatialwave_global', JSON.stringify(settings));
          resolve(true);
        } catch {
          resolve(false);
        }
      }
    });
  }

  /**
   * Extracts clean hostname/domain from a URL string
   */
  static getDomainFromUrl(url) {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StorageManager, DEFAULT_SETTINGS };
}

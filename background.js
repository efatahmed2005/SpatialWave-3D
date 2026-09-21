/**
 * SpatialWave 3D - Background Service Worker (Manifest V3)
 * Handles tab capture stream generation, persistent offscreen document lifecycle,
 * hotkey commands, and audio routing state.
 */

const OFFSCREEN_DOCUMENT_PATH = 'offscreen/offscreen.html';

// Global state tracking
let activeCaptureTabId = null;
let isCapturing = false;
let isBypassed = false;
let currentSettings = null;

/**
 * Ensures the offscreen document is created and running.
 * The offscreen document with AUDIO_PLAYBACK reason keeps audio processing
 * alive without the service worker suspending.
 */
async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH),
    reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: 'Low-latency audiophile 3D binaural spatial audio processing using AudioWorklet and tab capture'
  });
  console.log('[SpatialWave BG] Offscreen document created.');
}

/**
 * Starts tab audio capture for the specified or active tab.
 */
async function startCapture(targetTabId) {
  try {
    let tabId = targetTabId;
    if (!tabId) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        throw new Error('No active tab found to capture.');
      }
      tabId = tab.id;
    }

    await ensureOffscreenDocument();

    // Get the MediaStream ID for the target tab
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError || !streamId) {
        console.error('[SpatialWave BG] Failed to obtain tab capture streamId:', chrome.runtime.lastError);
        chrome.runtime.sendMessage({
          target: 'popup',
          action: 'CAPTURE_ERROR',
          error: chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Failed to capture tab audio.'
        });
        return;
      }

      activeCaptureTabId = tabId;
      isCapturing = true;
      isBypassed = false;

      // Update extension badge
      chrome.action.setBadgeText({ text: '3D' });
      chrome.action.setBadgeBackgroundColor({ color: '#00f5d4' });

      // Instruct offscreen document to capture and start DSP processing
      chrome.runtime.sendMessage({
        target: 'offscreen',
        action: 'INIT_STREAM',
        streamId,
        tabId
      });

      // Broadcast status to popup if open
      chrome.runtime.sendMessage({
        target: 'popup',
        action: 'CAPTURE_STATUS',
        isCapturing: true,
        isBypassed: false,
        tabId: activeCaptureTabId
      }).catch(() => {}); // popup might not be open
    });
  } catch (err) {
    console.error('[SpatialWave BG] startCapture error:', err);
  }
}

/**
 * Stops tab audio capture and releases offscreen audio resources.
 */
async function stopCapture() {
  isCapturing = false;
  activeCaptureTabId = null;

  chrome.action.setBadgeText({ text: '' });

  // Inform offscreen document to teardown AudioContext
  chrome.runtime.sendMessage({
    target: 'offscreen',
    action: 'STOP_STREAM'
  }).catch(() => {});

  chrome.runtime.sendMessage({
    target: 'popup',
    action: 'CAPTURE_STATUS',
    isCapturing: false,
    isBypassed: false,
    tabId: null
  }).catch(() => {});
}

// Clean up if captured tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeCaptureTabId) {
    console.log('[SpatialWave BG] Captured tab was closed. Stopping capture.');
    stopCapture();
  }
});

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
  console.log('[SpatialWave BG] Received command:', command);
  if (command === 'toggle_spatial') {
    chrome.runtime.sendMessage({
      target: 'offscreen',
      action: 'TOGGLE_POWER'
    }).catch(() => {});
  } else if (command === 'increase_intensity') {
    chrome.runtime.sendMessage({
      target: 'offscreen',
      action: 'ADJUST_INTENSITY',
      delta: 0.1
    }).catch(() => {});
  } else if (command === 'decrease_intensity') {
    chrome.runtime.sendMessage({
      target: 'offscreen',
      action: 'ADJUST_INTENSITY',
      delta: -0.1
    }).catch(() => {});
  }
});

// Central message dispatcher
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'background') return;

  switch (message.action) {
    case 'START_CAPTURE':
      startCapture(message.tabId);
      sendResponse({ status: 'starting' });
      break;

    case 'STOP_CAPTURE':
      stopCapture();
      sendResponse({ status: 'stopped' });
      break;

    case 'GET_STATUS':
      sendResponse({
        isCapturing,
        isBypassed,
        activeTabId: activeCaptureTabId
      });
      break;

    case 'UPDATE_SETTINGS':
      // Relay updated DSP parameters to offscreen document
      currentSettings = message.settings;
      chrome.runtime.sendMessage({
        target: 'offscreen',
        action: 'UPDATE_DSP_SETTINGS',
        settings: message.settings
      }).catch(() => {});
      sendResponse({ status: 'ok' });
      break;

    default:
      break;
  }
  return true;
});

const tabRegistrations = new Map();
const recomputeTimers = new Map();

const STORAGE_KEY = "syncstreamSessionsByTab";

function scheduleControllerPick(tabId) {
  if (recomputeTimers.has(tabId)) {
    clearTimeout(recomputeTimers.get(tabId));
  }
  recomputeTimers.set(
    tabId,
    setTimeout(() => {
      recomputeTimers.delete(tabId);
      pickAndNotifyController(tabId);
    }, 120)
  );
}

function pickAndNotifyController(tabId) {
  const frames = tabRegistrations.get(tabId);
  if (!frames || frames.size === 0) return;

  let bestFrameId = 0;
  let bestArea = -1;
  for (const [frameId, data] of frames) {
    if (data.area > bestArea) {
      bestArea = data.area;
      bestFrameId = frameId;
    }
  }

  const notify = (frameId, isController) => {
    chrome.tabs
      .sendMessage(
        tabId,
        { type: "SYNCSTREAM_CONTROLLER", tabId, isController, bestArea },
        { frameId }
      )
      .catch(() => {});
  };

  for (const frameId of frames.keys()) {
    notify(frameId, frameId === bestFrameId && bestArea > 0);
  }
}

function broadcastToTabFrames(tabId, message) {
  const frames = tabRegistrations.get(tabId);
  if (!frames) return;
  const payload = { ...message, tabId };
  for (const frameId of frames.keys()) {
    chrome.tabs.sendMessage(tabId, payload, { frameId }).catch(() => {});
  }
}

function readSessionsMap(cb) {
  chrome.storage.local.get([STORAGE_KEY], (r) => {
    if (chrome.runtime.lastError) {
      cb({});
      return;
    }
    const raw = r[STORAGE_KEY];
    cb(raw && typeof raw === "object" ? raw : {});
  });
}

function writeSessionsMap(map, cb) {
  chrome.storage.local.set({ [STORAGE_KEY]: map }, () => {
    if (cb) cb(!chrome.runtime.lastError);
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "SYNCSTREAM_REGISTER" && sender.tab?.id != null) {
    const tabId = sender.tab.id;
    const frameId = sender.frameId ?? 0;
    if (!tabRegistrations.has(tabId)) {
      tabRegistrations.set(tabId, new Map());
    }
    tabRegistrations.get(tabId).set(frameId, {
      area: Math.max(0, Number(msg.area) || 0),
      hasVideo: Boolean(msg.hasVideo),
    });
    scheduleControllerPick(tabId);
    sendResponse({ ok: true, tabId });
    return true;
  }

  if (msg?.type === "SYNCSTREAM_GET_TAB_ID" && sender.tab?.id != null) {
    sendResponse({ tabId: sender.tab.id });
    return true;
  }

  if (msg?.type === "SYNCSTREAM_GET_ACTIVE_TAB") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const t = tabs[0];
      sendResponse(t ? { tabId: t.id } : {});
    });
    return true;
  }

  if (msg?.type === "SYNCSTREAM_GET_SESSION_FOR_TAB") {
    const tabId = msg.tabId;
    if (tabId == null) {
      sendResponse({});
      return true;
    }
    readSessionsMap((map) => {
      const session = map[String(tabId)] ?? null;
      sendResponse({ session });
    });
    return true;
  }

  if (msg?.type === "SYNCSTREAM_APPLY_SESSION") {
    const session = msg.session || null;
    let tabId = msg.tabId;

    const finish = () => {
      if (tabId == null) {
        sendResponse({ ok: false });
        return;
      }
      if (session == null) {
        readSessionsMap((map) => {
          const key = String(tabId);
          if (map[key]) {
            delete map[key];
            writeSessionsMap(map, () => {
              broadcastToTabFrames(tabId, { type: "SYNCSTREAM_SESSION", session: null });
              sendResponse({ ok: true });
            });
            return;
          }
          broadcastToTabFrames(tabId, { type: "SYNCSTREAM_SESSION", session: null });
          sendResponse({ ok: true });
        });
        return;
      }
      readSessionsMap((map) => {
        const next = { ...map, [String(tabId)]: session };
        writeSessionsMap(next, () => {
          broadcastToTabFrames(tabId, { type: "SYNCSTREAM_SESSION", session });
          sendResponse({ ok: true });
        });
      });
    };

    if (tabId == null && session == null) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const t = tabs[0];
        tabId = t ? t.id : null;
        finish();
      });
      return true;
    }

    finish();
    return true;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabRegistrations.delete(tabId);
  if (recomputeTimers.has(tabId)) {
    clearTimeout(recomputeTimers.get(tabId));
    recomputeTimers.delete(tabId);
  }
  readSessionsMap((map) => {
    const key = String(tabId);
    if (!map[key]) return;
    delete map[key];
    writeSessionsMap(map);
  });
});

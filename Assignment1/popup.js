function $(id) {
  return document.getElementById(id);
}

function randomPeerId() {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return "ss-" + hex;
}

function getActiveTabId() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "SYNCSTREAM_GET_ACTIVE_TAB" }, (r) => {
      if (chrome.runtime.lastError) {
        resolve(undefined);
        return;
      }
      resolve(r && r.tabId);
    });
  });
}

function applySession(tabId, session) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "SYNCSTREAM_APPLY_SESSION", tabId, session }, (r) => {
      resolve(Boolean(r && r.ok));
    });
  });
}

function getSessionForTab(tabId) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "SYNCSTREAM_GET_SESSION_FOR_TAB", tabId }, (r) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(r?.session ?? null);
    });
  });
}

function setStatus(text, isError) {
  const el = $("status");
  el.textContent = text || "";
  el.classList.toggle("error", Boolean(isError));
}

async function refreshUiFromStorage() {
  const tabId = await getActiveTabId();
  if (tabId == null) return;
  const s = await getSessionForTab(tabId);
  const hostPanel = $("hostPanel");
  if (s && s.role === "host" && s.peerId) {
    hostPanel.classList.remove("hidden");
    $("hostId").value = s.peerId;
  } else {
    hostPanel.classList.add("hidden");
  }
  if (s && s.role === "guest" && s.remotePeerId) {
    $("remoteId").value = s.remotePeerId;
  }
}

$("btnHost").addEventListener("click", async () => {
  setStatus("");
  const tabId = await getActiveTabId();
  if (tabId == null) {
    setStatus("No active tab.", true);
    return;
  }
  const peerId = randomPeerId();
  const ok = await applySession(tabId, { role: "host", peerId });
  if (!ok) {
    setStatus("Could not start session.", true);
    return;
  }
  $("hostPanel").classList.remove("hidden");
  $("hostId").value = peerId;
  setStatus("Host ready — play or seek on the video tab; guest should follow.");
});

$("btnGuest").addEventListener("click", async () => {
  setStatus("");
  const remotePeerId = $("remoteId").value.trim();
  if (!remotePeerId) {
    setStatus("Enter the host Peer ID.", true);
    return;
  }
  const tabId = await getActiveTabId();
  if (tabId == null) {
    setStatus("No active tab.", true);
    return;
  }
  const ok = await applySession(tabId, { role: "guest", remotePeerId });
  if (!ok) {
    setStatus("Could not connect session.", true);
    return;
  }
  setStatus("Guest mode — waiting for host controls.");
});

$("btnDisconnect").addEventListener("click", async () => {
  const tabId = await getActiveTabId();
  await applySession(tabId ?? undefined, null);
  $("hostPanel").classList.add("hidden");
  $("remoteId").value = "";
  setStatus("Disconnected.");
});

$("btnCopy").addEventListener("click", () => {
  const v = $("hostId").value;
  if (!v) return;
  navigator.clipboard.writeText(v).then(
    () => setStatus("Copied."),
    () => setStatus("Copy failed.", true)
  );
});

document.addEventListener("DOMContentLoaded", refreshUiFromStorage);

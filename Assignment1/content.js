(function () {
  "use strict";

  const PeerCtor = typeof Peer !== "undefined" ? Peer : globalThis.Peer;
  if (!PeerCtor) {
    console.warn("[SyncStream] PeerJS not loaded.");
    return;
  }

  let myTabId = null;
  let isControllerFrame = false;
  let session = null;
  let peer = null;
  let dataConn = null;
  let boundVideo = null;
  const videoListeners = [];
  let applyingRemote = false;
  let reconnectTimer = null;
  let pendingRemotePayload = null;
  let extensionDead = false;
  let registrationIntervalId = null;
  let mutationObserver = null;

  function isExtensionContextAlive() {
    if (extensionDead) return false;
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      extensionDead = true;
      return false;
    }
  }

  function invalidateExtensionContext() {
    if (extensionDead) return;
    extensionDead = true;
    if (mutationObserver) {
      try {
        mutationObserver.disconnect();
      } catch (e) {}
      mutationObserver = null;
    }
    if (registrationIntervalId != null) {
      clearInterval(registrationIntervalId);
      registrationIntervalId = null;
    }
    teardownPeer();
  }

  function lastErrorInvalidated() {
    try {
      const m = chrome.runtime.lastError && chrome.runtime.lastError.message;
      return typeof m === "string" && m.includes("Extension context invalidated");
    } catch (e) {
      return true;
    }
  }

  function sendRuntimeMessage(payload, onReply) {
    if (!isExtensionContextAlive()) return;
    try {
      chrome.runtime.sendMessage(payload, (r) => {
        if (extensionDead) return;
        if (lastErrorInvalidated()) {
          invalidateExtensionContext();
          return;
        }
        if (chrome.runtime.lastError) return;
        if (onReply) onReply(r);
      });
    } catch (e) {
      const msg = e && e.message ? String(e.message) : String(e);
      if (msg.includes("Extension context invalidated")) {
        invalidateExtensionContext();
        return;
      }
      throw e;
    }
  }

  const PEER_OPTS = {
    host: "0.peerjs.com",
    port: 443,
    path: "/",
    secure: true,
    debug: 0,
    config: {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
      ],
    },
  };

  const CONNECT_OPTS = { reliable: true, serialization: "json" };

  function sessionEqual(a, b) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return (
      a.role === b.role && a.peerId === b.peerId && a.remotePeerId === b.remotePeerId
    );
  }

  function acceptMessageForThisTab(msg) {
    if (msg?.tabId == null) return true;
    if (myTabId == null) {
      myTabId = msg.tabId;
      return true;
    }
    return msg.tabId === myTabId;
  }

  function videoVisibleArea(el) {
    const rect = el.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w < 4 || h < 4) return 0;
    const st = window.getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) === 0) {
      return 0;
    }
    return w * h;
  }

  function collectVideosDeep(root, out) {
    if (!root) return;
    try {
      root.querySelectorAll("video").forEach((v) => out.push(v));
      root.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) collectVideosDeep(el.shadowRoot, out);
      });
    } catch (e) {
      /* restricted subtree */
    }
  }

  function findLargestVideo() {
    const videos = [];
    collectVideosDeep(document.documentElement, videos);
    let best = null;
    let bestArea = 0;
    for (const v of videos) {
      const a = videoVisibleArea(v);
      if (a > bestArea) {
        bestArea = a;
        best = v;
      }
    }
    return { element: best, area: bestArea };
  }

  function reportRegistration() {
    if (!isExtensionContextAlive()) return;
    const { element, area } = findLargestVideo();
    sendRuntimeMessage(
      {
        type: "SYNCSTREAM_REGISTER",
        area,
        hasVideo: !!element,
      },
      (r) => {
        if (!isExtensionContextAlive()) return;
        if (r?.tabId != null) {
          const firstId = myTabId == null;
          myTabId = r.tabId;
          if (firstId) loadSessionForTab();
        }
      }
    );
  }

  function loadSessionForTab() {
    if (myTabId == null || !isExtensionContextAlive()) return;
    sendRuntimeMessage({ type: "SYNCSTREAM_GET_SESSION_FOR_TAB", tabId: myTabId }, (r) => {
      if (!isExtensionContextAlive()) return;
      onSessionUpdate(r?.session || null);
    });
  }

  function clearVideoListeners() {
    for (const { el, type, fn } of videoListeners) {
      el.removeEventListener(type, fn);
    }
    videoListeners.length = 0;
  }

  function detachVideo() {
    clearVideoListeners();
    boundVideo = null;
  }

  function canSend() {
    return Boolean(dataConn && dataConn.open);
  }

  function sendToPeer(payload) {
    if (!canSend()) return;
    try {
      dataConn.send(payload);
    } catch (e) {
      console.warn("[SyncStream] send failed", e);
    }
  }

  function hostSnapshot(video) {
    return {
      action: "sync",
      time: Number(video.currentTime) || 0,
      paused: video.paused,
    };
  }

  function onHostPlay() {
    if (!boundVideo || applyingRemote) return;
    sendToPeer(hostSnapshot(boundVideo));
  }

  function onHostPause() {
    if (!boundVideo || applyingRemote) return;
    sendToPeer(hostSnapshot(boundVideo));
  }

  function onHostSeeked() {
    if (!boundVideo || applyingRemote) return;
    sendToPeer(hostSnapshot(boundVideo));
  }

  function onHostWaiting() {
    if (!boundVideo || applyingRemote) return;
    sendToPeer({ action: "pause", time: Number(boundVideo.currentTime) || 0 });
  }

  function onHostPlaying() {
    if (!boundVideo || applyingRemote) return;
    sendToPeer(hostSnapshot(boundVideo));
  }

  function applyRemotePayload(data) {
    const v = boundVideo;
    if (!v || !data) return false;

    if (data.action === "pause") {
      const t = typeof data.time === "number" ? data.time : v.currentTime;
      applyingRemote = true;
      try {
        v.pause();
        if (Math.abs(v.currentTime - t) > 0.25) v.currentTime = t;
      } finally {
        requestAnimationFrame(() => {
          applyingRemote = false;
        });
      }
      return true;
    }

    if (data.action === "sync") {
      const t = typeof data.time === "number" ? data.time : v.currentTime;
      const paused = Boolean(data.paused);
      applyingRemote = true;
      try {
        if (Math.abs(v.currentTime - t) > 0.35) v.currentTime = t;
        if (paused) v.pause();
        else {
          const p = v.play();
          if (p && typeof p.catch === "function") p.catch(() => {});
        }
      } finally {
        requestAnimationFrame(() => {
          applyingRemote = false;
        });
      }
      return true;
    }
    return false;
  }

  function flushPendingRemote() {
    if (session?.role !== "guest" || !pendingRemotePayload) return;
    if (boundVideo && applyRemotePayload(pendingRemotePayload)) {
      pendingRemotePayload = null;
    }
  }

  function attachToVideo(video) {
    if (!video || !isControllerFrame || !session || session.role === "idle") return;
    detachVideo();
    boundVideo = video;

    if (session.role === "host") {
      let lastTimeSent = -1;
      let lastTimeUpdateSendAt = 0;
      const onTimeUpdate = () => {
        if (!boundVideo || applyingRemote) return;
        const now = performance.now();
        if (now - lastTimeUpdateSendAt < 2000) return;
        const t = Number(boundVideo.currentTime) || 0;
        if (lastTimeSent >= 0 && Math.abs(t - lastTimeSent) < 0.35) return;
        lastTimeSent = t;
        lastTimeUpdateSendAt = now;
        sendToPeer(hostSnapshot(boundVideo));
      };
      const add = (type, fn) => {
        video.addEventListener(type, fn);
        videoListeners.push({ el: video, type, fn });
      };
      add("play", onHostPlay);
      add("pause", onHostPause);
      add("seeked", onHostSeeked);
      add("timeupdate", onTimeUpdate);
      add("waiting", onHostWaiting);
      add("stalled", onHostWaiting);
      add("playing", onHostPlaying);
    }

    flushPendingRemote();
  }

  function bindBestVideo() {
    const { element } = findLargestVideo();
    if (element && element !== boundVideo) {
      attachToVideo(element);
    } else if (!element) {
      detachVideo();
    } else {
      flushPendingRemote();
    }
  }

  function teardownPeer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    detachVideo();
    if (dataConn) {
      try {
        dataConn.close();
      } catch (e) {}
      dataConn = null;
    }
    if (peer) {
      try {
        peer.destroy();
      } catch (e) {}
      peer = null;
    }
  }

  function setupDataConnection(conn) {
    if (dataConn && dataConn !== conn) {
      try {
        dataConn.close();
      } catch (e) {}
    }
    dataConn = conn;

    conn.on("data", (data) => {
      if (!session || session.role !== "guest") return;
      if (boundVideo) {
        applyRemotePayload(data);
      } else {
        pendingRemotePayload = data;
      }
    });

    conn.on("close", () => {
      if (dataConn === conn) dataConn = null;
    });

    conn.on("error", (err) => {
      console.warn("[SyncStream] DataConnection error", err);
    });

    bindBestVideo();

    if (session?.role === "host" && boundVideo && canSend()) {
      sendToPeer(hostSnapshot(boundVideo));
    }
  }

  function initPeerFromSession() {
    teardownPeer();
    pendingRemotePayload = null;
    if (!session || !isControllerFrame) return;
    if (session.role !== "host" && session.role !== "guest") return;

    try {
      if (session.role === "host") {
        const id = session.peerId;
        if (!id) return;
        peer = new PeerCtor(id, PEER_OPTS);
        peer.on("open", () => {});
        peer.on("connection", (conn) => {
          conn.on("open", () => {
            setupDataConnection(conn);
          });
          conn.on("error", (e) => console.warn("[SyncStream] incoming connection error", e));
        });
        peer.on("error", (err) => console.warn("[SyncStream] Peer error (host)", err));
      } else {
        const remote = session.remotePeerId;
        if (!remote) return;
        peer = new PeerCtor(PEER_OPTS);
        peer.on("open", () => {
          const conn = peer.connect(remote, CONNECT_OPTS);
          conn.on("open", () => {
            setupDataConnection(conn);
          });
          conn.on("error", (e) => console.warn("[SyncStream] connection error", e));
        });
        peer.on("error", (err) => console.warn("[SyncStream] Peer error (guest)", err));
      }
    } catch (e) {
      console.warn("[SyncStream] initPeer failed", e);
    }
  }

  function onSessionUpdate(next) {
    if (sessionEqual(session, next)) {
      if (isControllerFrame && next) bindBestVideo();
      return;
    }
    session = next;
    if (!isControllerFrame) {
      teardownPeer();
      return;
    }
    if (!session) {
      teardownPeer();
      return;
    }
    initPeerFromSession();
    bindBestVideo();
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!isExtensionContextAlive()) return;
    if (msg?.type === "SYNCSTREAM_CONTROLLER") {
      if (!acceptMessageForThisTab(msg)) return;
      const wasController = isControllerFrame;
      isControllerFrame = Boolean(msg.isController);
      if (isControllerFrame && !wasController && myTabId != null) {
        loadSessionForTab();
      }
      if (!isControllerFrame) {
        teardownPeer();
      } else if (session && session.role && session.role !== "idle") {
        initPeerFromSession();
      }
      bindBestVideo();
      return;
    }
    if (msg?.type === "SYNCSTREAM_SESSION") {
      if (!acceptMessageForThisTab(msg)) return;
      onSessionUpdate(msg.session || null);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (!isExtensionContextAlive()) return;
    if (area !== "local" || !changes.syncstreamSessionsByTab || myTabId == null) return;
    const nextMap = changes.syncstreamSessionsByTab.newValue;
    const key = String(myTabId);
    if (nextMap == null || typeof nextMap !== "object") {
      onSessionUpdate(null);
      return;
    }
    const next = Object.prototype.hasOwnProperty.call(nextMap, key) ? nextMap[key] : null;
    onSessionUpdate(next);
  });

  reportRegistration();

  mutationObserver = new MutationObserver(() => {
    if (!isExtensionContextAlive()) return;
    reportRegistration();
    if (isControllerFrame && session?.role) {
      bindBestVideo();
    }
  });
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true });

  registrationIntervalId = setInterval(reportRegistration, 4000);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", reportRegistration);
  }
})();

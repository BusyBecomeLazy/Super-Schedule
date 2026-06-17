const { WS_BASE_URL } = require("./config");
const { getStoredToken } = require("./session");

let socketTask = null;
let activeGroupId = null;
let messageHandler = null;
let reconnectTimer = null;
let manualClose = false;
let hasOpened = false;
let reconnectAttempts = 0;

function connectGroupSocket(groupId, onMessage) {
  const token = getStoredToken();
  if (!token || !groupId) {
    return;
  }

  messageHandler = onMessage;

  if (socketTask && activeGroupId === groupId) {
    return;
  }

  closeGroupSocket({ reconnect: false });
  manualClose = false;
  hasOpened = false;
  reconnectAttempts = 0;
  activeGroupId = groupId;

  socketTask = wx.connectSocket({
    url: `${WS_BASE_URL}/ws/groups/${groupId}?token=${encodeURIComponent(token)}`
  });

  socketTask.onOpen(() => {
    clearReconnectTimer();
    hasOpened = true;
    reconnectAttempts = 0;
    console.info("group socket opened", groupId);
  });

  socketTask.onMessage((event) => {
    try {
      const payload = JSON.parse(event.data);
      if (messageHandler) {
        messageHandler(payload);
      }
    } catch (error) {
      console.warn("ignored malformed socket message", error);
    }
  });

  socketTask.onClose((event) => {
    socketTask = null;
    if (!manualClose && hasOpened) {
      scheduleReconnect();
    } else if (!manualClose) {
      console.info("group socket closed before open", event);
    }
  });

  socketTask.onError((error) => {
    console.info("group socket unavailable, realtime sync paused", error);
  });
}

function closeGroupSocket(options = { reconnect: false }) {
  clearReconnectTimer();
  manualClose = !options.reconnect;
  if (socketTask) {
    socketTask.close({});
    socketTask = null;
  }
}

function scheduleReconnect() {
  clearReconnectTimer();
  if (!activeGroupId || !messageHandler || reconnectAttempts >= 3) {
    return;
  }
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    connectGroupSocket(activeGroupId, messageHandler);
  }, 1500 * reconnectAttempts);
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

module.exports = {
  connectGroupSocket,
  closeGroupSocket
};

const LAN_HOST = "172.20.10.3:8000";
const LOCAL_HOST = "127.0.0.1:8000";

function isDevtools() {
  try {
    return wx.getSystemInfoSync().platform === "devtools";
  } catch {
    return false;
  }
}

const HOST = isDevtools() ? LOCAL_HOST : LAN_HOST;
const API_BASE_URL = `http://${HOST}/api`;
const WS_BASE_URL = `ws://${HOST}`;

module.exports = {
  API_BASE_URL,
  WS_BASE_URL
};

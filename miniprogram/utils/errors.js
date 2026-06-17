function toastTitle(error, fallback) {
  if (error && typeof error === "object" && error.detail) {
    return String(error.detail).slice(0, 20);
  }
  if (typeof error === "string") {
    return error.slice(0, 20);
  }
  return fallback;
}

module.exports = {
  toastTitle
};

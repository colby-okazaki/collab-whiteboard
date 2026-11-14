// A token bucket: a connection may send a burst of up to `capacity`
// messages, then on average `perSecond` more each second. Normal use stays
// far below this (cursors and stroke points are already throttled by the
// client), so only a flooding client ever hits it.
function createRateLimiter({ capacity, perSecond, now = Date.now }) {
  let tokens = capacity;
  let last = now();

  return {
    allow() {
      const t = now();
      tokens = Math.min(capacity, tokens + ((t - last) / 1000) * perSecond);
      last = t;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}

module.exports = { createRateLimiter };

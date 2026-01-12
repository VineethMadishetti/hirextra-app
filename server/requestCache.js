export const requestCache = (duration = 60) => {
  const cache = new Map();
  const MAX_SIZE = 500;

  return (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    const key = req.originalUrl || req.url;
    let cachedResponse = cache.get(key);

    if (cachedResponse) {
      // LRU behavior: refresh key position (delete and re-add moves it to the end)
      cache.delete(key);
      cache.set(key, cachedResponse);

      const { body, contentType, timestamp } = cachedResponse;
      // Check if cache is valid
      const age = (Date.now() - timestamp) / 1000;
      if (age < duration) {
        if (contentType) res.setHeader('Content-Type', contentType);
        // Tell browser to use its local cache for the remaining time
        res.setHeader('Cache-Control', `public, max-age=${Math.floor(duration - age)}, stale-while-revalidate=${duration}`);
        return res.send(body);
      }
      cache.delete(key);
    }

    const originalSend = res.send;
    res.send = function (body) {
      if (res.statusCode === 200) {
        // Tell browser to cache this fresh response
        res.setHeader('Cache-Control', `public, max-age=${duration}, stale-while-revalidate=${duration}`);

        // Limit cache size to prevent memory leaks
        if (cache.size >= MAX_SIZE) {
          const oldestKey = cache.keys().next().value;
          cache.delete(oldestKey);
        }

        cache.set(key, {
          body,
          contentType: res.get('Content-Type'),
          timestamp: Date.now(),
        });
      }
      return originalSend.call(this, body);
    };

    next();
  };
};
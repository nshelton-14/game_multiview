// Page-world half of the geolocation spoof. Replaces navigator.geolocation
// lookups with the per-tab location supplied by geo-bridge.js. If no location
// is configured for this tab, the real browser geolocation is used.
(() => {
  const root = document.documentElement;
  const pending = new Map();
  let nextId = 0;
  let watchId = 0;

  root.addEventListener('mv-geo-response', e => {
    const { id, geo } = JSON.parse(e.detail);
    const resolve = pending.get(id);
    if (resolve) {
      pending.delete(id);
      resolve(geo);
    }
  });

  const askForGeo = () => new Promise(resolve => {
    const id = ++nextId;
    pending.set(id, resolve);
    setTimeout(() => {
      if (pending.delete(id)) resolve(null);
    }, 6000);
    root.dispatchEvent(new CustomEvent('mv-geo-request', { detail: id }));
  });

  const makePosition = geo => ({
    timestamp: Date.now(),
    coords: {
      latitude: geo.lat,
      longitude: geo.lng,
      accuracy: 64.1,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null
    }
  });

  const geolocation = navigator.geolocation;
  if (!geolocation) return;
  const realGetCurrentPosition = geolocation.getCurrentPosition.bind(geolocation);

  geolocation.getCurrentPosition = (success, error, options) => {
    askForGeo().then(geo => {
      if (geo) {
        try { success(makePosition(geo)); } catch (e) { console.error(e); }
      } else {
        realGetCurrentPosition(success, error, options);
      }
    });
  };

  geolocation.watchPosition = (success, error, options) => {
    geolocation.getCurrentPosition(success, error, options);
    return ++watchId;
  };

  if (navigator.permissions && navigator.permissions.query) {
    const realQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = descriptor => {
      if (!descriptor || descriptor.name !== 'geolocation') return realQuery(descriptor);
      return Promise.all([realQuery(descriptor), askForGeo()]).then(([status, geo]) => {
        if (!geo) return status;
        return {
          state: 'granted',
          onchange: null,
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() { return false; }
        };
      });
    };
  }
})();

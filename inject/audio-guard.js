// Runs in the page's own world inside every grid frame, before YouTube's code.
// The grid host writes which frame may have sound into the top document's
// data-mv-audio attribute ("-1" = none). Here we stop the page from unmuting
// media in any other frame, so a new <video> (ad break, stream switch, refresh)
// can never leak sound before the host's after-the-fact muting catches up.
(() => {
  const match = /^mv:(\d+)$/.exec(window.name);
  if (!match || window.top === window) return;
  const me = match[1];

  const allowed = () => {
    try {
      return window.top.document.documentElement.getAttribute('data-mv-audio') === me;
    } catch (err) {
      return true; // can't tell: don't interfere
    }
  };

  const proto = HTMLMediaElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'muted');
  if (desc && desc.set) {
    Object.defineProperty(proto, 'muted', {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set(value) { desc.set.call(this, allowed() ? value : true); }
    });
  }

  const play = proto.play;
  proto.play = function (...args) {
    if (!allowed() && desc && desc.set) desc.set.call(this, true);
    return play.apply(this, args);
  };

  // Elements created unmuted that start playing without going through the above.
  for (const name of ['loadstart', 'play', 'playing', 'volumechange']) {
    document.addEventListener(name, e => {
      const media = e.target;
      if (media instanceof HTMLMediaElement && !media.muted && !allowed()) desc.set.call(media, true);
    }, true);
  }
})();

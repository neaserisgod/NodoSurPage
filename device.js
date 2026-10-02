/* Detecta el dispositivo de quien visita para ofrecerle la descarga que le corresponde.
   Expone window.NS_DEVICE = { id: 'windows' | 'android' | 'macos' | 'linux' | 'ios' | 'other', name }.
   Solo lee datos del navegador; no manda nada a ningún lado. */
(function () {
  var ua = navigator.userAgent || '';
  var uad = navigator.userAgentData;
  var plat = (uad && uad.platform) || navigator.platform || '';
  var touch = (navigator.maxTouchPoints || 0) > 1;
  var id = 'other';
  if (/android/i.test(ua)) id = 'android'; // antes que Linux: el user agent de Android también dice Linux
  else if (/iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(plat) && touch)) id = 'ios'; // iPadOS se presenta como Mac
  else if (/Win/i.test(plat) || /Windows/i.test(ua)) id = 'windows';
  else if (/Mac/i.test(plat) || /Macintosh/i.test(ua)) id = 'macos';
  else if (/Linux|X11|CrOS/i.test(plat + ' ' + ua)) id = 'linux';
  var names = { windows: 'Windows', android: 'Android', macos: 'Mac', linux: 'Linux', ios: 'iPhone o iPad', other: '' };
  window.NS_DEVICE = { id: id, name: names[id] || '' };
})();

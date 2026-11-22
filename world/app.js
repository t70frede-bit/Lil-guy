// Lil guy's world: his house, the empty land outside, and whatever gets built for him.
// Reads the shared map (/world.json) and his live state (/state). No build step.
(function () {
  'use strict';
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const $ = id => document.getElementById(id);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cap = t => t ? t[0].toUpperCase() + t.slice(1) : t;
  const hhmm = iso => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  function timeAgo(ms) {
    const m = Math.round(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
    const h = Math.round(m / 60);
    if (h < 48) return h + (h === 1 ? ' hour ago' : ' hours ago');
    return Math.round(h / 24) + ' days ago';
  }

  // ---------- HUD panels ----------
  const buttons = [...document.querySelectorAll('.dock button')];
  let openPanel = null;
  function show(name, force) {
    openPanel = (openPanel === name && !force) ? null : name;
    buttons.forEach(b => b.setAttribute('aria-expanded', String(b.dataset.panel === openPanel)));
    document.querySelectorAll('.panel').forEach(p => { p.hidden = p.id !== 'p-' + openPanel; });
    const hint = document.querySelector('.hint'); if (hint) hint.hidden = !!openPanel;
  }
  buttons.forEach(b => b.addEventListener('click', () => show(b.dataset.panel)));
  document.querySelectorAll('.panel .close').forEach(b => b.addEventListener('click', () => show(openPanel)));
  addEventListener('keydown', e => { if (e.key === 'Escape' && openPanel) show(openPanel); });

  const toastEl = $('toast'); let toastTimer = 0;
  function toast(text) { toastEl.textContent = text; toastEl.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 5000); }
  const bubble = $('bubble');
  function say(t) { bubble.textContent = t.length > 160 ? t.slice(0, 157) + '...' : t; }

  // ---------- Needs bars ----------
  const NEEDS = [['energy', 'Energy', 'E'], ['curiosity', 'Curiosity', 'C'], ['company', 'Company', 'Co'], ['feisty', 'Feistiness', 'F'], ['fulfilled', 'Fulfilled', 'Fu']];
  $('needs').innerHTML = NEEDS.map(([k, label]) =>
    '<div class="need"><span>' + label + '</span><div class="bar"><b id="b-' + k + '"></b></div><output id="o-' + k + '"></output></div>').join('');
  $('mini').innerHTML = NEEDS.map(([k, label, short]) =>
    '<div title="' + label + '" aria-label="' + label + '"><span>' + short + '</span><div class="bar"><b id="m-' + k + '"></b></div></div>').join('');

  // ---------- Three.js setup ----------
  const stage = $('stage');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  stage.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfe3f5);
  scene.fog = new THREE.Fog(0xbfe3f5, 26, 60);
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200);
  camera.position.set(1, 7.5, 12.5);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a9a6b, 0.6); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 0.6); sun.position.set(6, 12, 8); scene.add(sun);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false;
  controls.minDistance = 4; controls.maxDistance = 28;
  controls.minPolarAngle = 0.35; controls.maxPolarAngle = 1.38;
  controls.target.set(0, 0.6, 0);
  let userMovedAt = 0;
  controls.addEventListener('start', () => { userMovedAt = performance.now(); });

  const grad = new THREE.DataTexture(new Uint8Array([120, 195, 255]), 3, 1, THREE.LuminanceFormat);
  grad.minFilter = grad.magFilter = THREE.NearestFilter; grad.needsUpdate = true;
  const toon = c => new THREE.MeshToonMaterial({ color: c, gradientMap: grad });
  const basic = c => new THREE.MeshBasicMaterial({ color: c });
  function mesh(geo, mat, x, y, z, parent) { const m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); (parent || scene).add(m); return m; }
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const sph = (r, a, b) => new THREE.SphereGeometry(r, a || 20, b || 14);
  const cyl = (rt, rb, h, n) => new THREE.CylinderGeometry(rt, rb, h, n || 16);

  function labelTexture(text, bg, fg) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128; const x = c.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, 512, 128);
    x.fillStyle = fg; x.font = '600 52px Fredoka, Trebuchet MS, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    let t = text; while (x.measureText(t).width > 480 && t.length > 4) t = t.slice(0, -2);
    if (t !== text) t = t.slice(0, -1) + '...';
    x.fillText(t, 256, 66);
    const tex = new THREE.CanvasTexture(c); return tex;
  }
  function sign(text, parent, x, y, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
    mesh(cyl(0.05, 0.05, y, 8), toon(0x8a5a3c), 0, y / 2, 0, g);
    const board = mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ map: labelTexture(text, '#f6efe2', '#2a2433'), side: THREE.DoubleSide }), 0, y + 0.1, 0.03, g);
    mesh(box(1.66, 0.46, 0.05), toon(0x8a5a3c), 0, y + 0.1, 0, g);
    return board;
  }

  // ---------- Ground, house shell ----------
  const grass = mesh(new THREE.CircleGeometry(60, 64), toon(0x9cc770), 0, -0.02, 0); grass.rotation.x = -Math.PI / 2;
  // a path from the door out into the field
  const path = mesh(new THREE.PlaneGeometry(26, 1.3), toon(0xd8c39a), 17.5, 0.0, 0.6); path.rotation.x = -Math.PI / 2;

  const HOUSE = { x0: -4.6, x1: 4.6, z0: -3.0, z1: 3.2, h: 3.0 };
  const house = new THREE.Group(); scene.add(house);
  mesh(box(HOUSE.x1 - HOUSE.x0, 0.2, HOUSE.z1 - HOUSE.z0), toon(0xc9a27a), 0, -0.08, (HOUSE.z0 + HOUSE.z1) / 2, house);
  const wallMat = toon(0xead7c3);
  mesh(box(HOUSE.x1 - HOUSE.x0, HOUSE.h, 0.2), wallMat, 0, HOUSE.h / 2, HOUSE.z0, house); // back
  mesh(box(0.2, HOUSE.h, HOUSE.z1 - HOUSE.z0), wallMat, HOUSE.x0, HOUSE.h / 2, (HOUSE.z0 + HOUSE.z1) / 2, house); // left
  // right wall with a door hole around z = 0.6
  mesh(box(0.2, HOUSE.h, 2.6), wallMat, HOUSE.x1, HOUSE.h / 2, HOUSE.z0 + 1.3, house);
  mesh(box(0.2, HOUSE.h, 1.5), wallMat, HOUSE.x1, HOUSE.h / 2, HOUSE.z1 - 0.75, house);
  mesh(box(0.2, 0.8, 1.6), wallMat, HOUSE.x1, HOUSE.h - 0.4, 0.6, house);
  // roof trim so it reads as a house from far away
  const roofMat = toon(0xc76b5a);
  mesh(box(HOUSE.x1 - HOUSE.x0 + 0.6, 0.25, 0.9), roofMat, 0, HOUSE.h + 0.1, HOUSE.z0 + 0.2, house);
  mesh(box(0.9, 0.25, HOUSE.z1 - HOUSE.z0 + 0.6), roofMat, HOUSE.x0 + 0.2, HOUSE.h + 0.1, (HOUSE.z0 + HOUSE.z1) / 2, house);
  mesh(box(0.9, 0.25, HOUSE.z1 - HOUSE.z0 + 0.6), roofMat, HOUSE.x1 - 0.2, HOUSE.h + 0.1, (HOUSE.z0 + HOUSE.z1) / 2, house);

  // ---------- Objects ----------
  // Every thing he can be next to gets a group with userData.objId, and an update(state) to show its state.
  const things = {};      // id -> { def, group, update, spot: [x, z] }
  let world = null;       // world.json
  const S = {             // latest state from his server
    needs: { energy: 0.8, curiosity: 0.55, company: 0.7, feisty: 0.1, fulfilled: 0.5 },
    sleeping: false, place: 'rug', mood: 'content', objects: {}, built: [], uses: {}, items: [], wishes: [], projects: [], secrets: {}, wonder: null
  };

  const builders = {
    bed(g) {
      mesh(box(1.6, 0.22, 1.1), toon(0x7aa6d8), 0, 0.11, 0, g);
      mesh(box(1.62, 0.23, 0.16), toon(0xf6f1e9), 0, 0.11, 0.2, g);
      mesh(box(1.62, 0.23, 0.16), toon(0xf6f1e9), 0, 0.11, -0.2, g);
      const pillow = mesh(sph(0.22), toon(0xffffff), -0.5, 0.3, 0, g); pillow.scale.set(1.3, 0.6, 1);
      const blanket = mesh(box(0.9, 0.08, 1.0), toon(0xf0c27b), 0.3, 0.26, 0, g);
      return st => { blanket.rotation.z = st === 'messy' ? 0.35 : 0; blanket.position.x = st === 'messy' ? 0.55 : 0.3; pillow.rotation.y = st === 'messy' ? 0.7 : 0; };
    },
    shelf(g) {
      mesh(box(1.5, 2.6, 0.5), toon(0x7d5238), 0, 1.3, 0, g);
      [0.25, 1.05, 1.85].forEach(y => mesh(box(1.4, 0.06, 0.48), toon(0x9a6b4a), 0, y, 0.03, g));
      const cols = [0xc2473d, 0x2f8f5b, 0x6a4fd8, 0xe0a548, 0x3b7dd8, 0xd86ca8];
      for (let row = 0; row < 3; row++) { let x = -0.62; for (let i = 0; i < 6; i++) { const w = 0.1 + ((i * 37 + row * 11) % 7) / 60, h = 0.42 + ((i * 13 + row) % 5) / 20; if (x + w > 0.66) break; mesh(box(w, h, 0.34), toon(cols[(i + row * 2) % 6]), x + w / 2, 0.28 + row * 0.8 + h / 2, 0.1, g); x += w + 0.02; } }
      const out = mesh(box(0.5, 0.08, 0.36), toon(0xc2473d), 0.2, 0.04, 0.8, g);
      return st => { out.visible = st === 'a book is out'; };
    },
    rug(g) {
      const r = mesh(new THREE.CircleGeometry(1.3, 48), toon(0xc76b5a), 0, 0.045, 0, g); r.rotation.x = -Math.PI / 2;
      const ring = mesh(new THREE.RingGeometry(0.8, 0.95, 48), toon(0xf0c27b), 0, 0.05, 0, g); ring.rotation.x = -Math.PI / 2;
      const hump = mesh(sph(0.6, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xc76b5a), 0.3, 0, -0.2, g); hump.scale.set(1.2, 0.5, 0.8);
      return st => { hump.visible = st === 'scrunched'; r.scale.setScalar(st === 'scrunched' ? 0.8 : 1); ring.scale.setScalar(st === 'scrunched' ? 0.8 : 1); };
    },
    window(g) {
      mesh(box(1.9, 1.9, 0.1), toon(0xffffff), 0, 2.0, 0, g);
      const sky = mesh(new THREE.PlaneGeometry(1.6, 1.6), basic(0x9fd3ff), 0, 2.0, 0.06, g); g.userData.sky = sky;
      const l = new THREE.Group(); l.position.set(-0.8, 2.0, 0.1); g.add(l); mesh(box(0.8, 1.6, 0.05), new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: grad, transparent: true, opacity: 0.35 }), 0.4, 0, 0, l);
      const r = new THREE.Group(); r.position.set(0.8, 2.0, 0.1); g.add(r); mesh(box(0.8, 1.6, 0.05), new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: grad, transparent: true, opacity: 0.35 }), -0.4, 0, 0, r);
      mesh(box(2.2, 0.12, 0.45), toon(0xffffff), 0, 1.0, 0.18, g);
      return st => { const a = st === 'open' ? 1.2 : 0; l.rotation.y = -a; r.rotation.y = a; };
    },
    lamp(g) {
      mesh(cyl(0.25, 0.3, 0.1), toon(0x6b6478), 0, 0.05, 0, g);
      mesh(cyl(0.04, 0.04, 1.6, 8), toon(0x6b6478), 0, 0.85, 0, g);
      const shade = mesh(cyl(0.22, 0.42, 0.45, 20), new THREE.MeshToonMaterial({ color: 0xf6e3b4, gradientMap: grad, emissive: 0x000000 }), 0, 1.75, 0, g);
      const light = new THREE.PointLight(0xffd48a, 0, 4.5, 2); light.position.set(0, 1.6, 0.3); g.add(light);
      return st => { const on = st === 'on'; shade.material.emissive.set(on ? 0xffc35a : 0x000000); light.intensity = on ? 0.9 : 0; };
    },
    plant(g) {
      // a tiny plant in a thimble pot, smaller than him; its leaves droop when it is thirsty
      mesh(cyl(0.16, 0.12, 0.26, 16), toon(0xb0b4b8), 0, 0.13, 0, g);
      mesh(cyl(0.15, 0.15, 0.02, 16), toon(0x5b4636), 0, 0.25, 0, g);
      mesh(cyl(0.015, 0.015, 0.3, 6), toon(0x2f8f5b), 0, 0.4, 0, g);
      const leaves = [-1, 1].map(side => { const l = new THREE.Group(); l.position.set(0, 0.46, 0); g.add(l); const leaf = mesh(sph(0.09, 10, 8), toon(0x55b36b), side * 0.09, 0, 0, l); leaf.scale.set(1.4, 0.35, 0.8); l.userData.side = side; return l; });
      return st => { const thirsty = /thirsty/.test(st || ''); leaves.forEach(l => { l.rotation.z = l.userData.side * (thirsty ? -0.7 : 0.25); }); };
    },
    ball(g) {
      const b = mesh(sph(0.42, 24, 16), toon(0xe0a548), 0, 0.42, 0, g);
      mesh(new THREE.TorusGeometry(0.42, 0.05, 8, 32), toon(0xc2473d), 0, 0.42, 0, g).rotation.y = 0.6;
      g.userData.ball = b; return () => {};
    },
    computer(g) {
      // his little computer on a low desk against the left wall, sized for him; the screen faces the room
      g.rotation.y = Math.PI / 2;
      const wood = toon(0x9a6b4a);
      mesh(box(1.1, 0.06, 0.6), wood, 0, 0.45, 0, g);
      [[-0.5, -0.25], [0.5, -0.25], [-0.5, 0.25], [0.5, 0.25]].forEach(([x, z]) => mesh(box(0.06, 0.45, 0.06), wood, x, 0.22, z, g));
      const shell = toon(0xe9dfc8);
      mesh(box(0.52, 0.42, 0.4), shell, 0, 0.7, -0.08, g);
      mesh(box(0.3, 0.05, 0.22), shell, 0, 0.5, -0.08, g);
      const screenMat = new THREE.MeshBasicMaterial({ color: 0x2a3a33 });
      const screen = mesh(new THREE.PlaneGeometry(0.4, 0.3), screenMat, 0, 0.72, 0.125, g);
      // lines of text that appear while he types, and a cursor
      const lines = [0, 1, 2].map(i => { const l = mesh(new THREE.PlaneGeometry(0.28, 0.025), basic(0xb6ffcf), -0.02, 0.8 - i * 0.06, 0.127, g); l.visible = false; return l; });
      const cursor = mesh(new THREE.PlaneGeometry(0.025, 0.04), basic(0xb6ffcf), -0.15, 0.62, 0.128, g);
      const key = mesh(box(0.42, 0.03, 0.15), toon(0xd3c8ae), 0, 0.5, 0.18, g);
      const btn = mesh(cyl(0.025, 0.025, 0.02, 10), toon(0xc2473d), 0.2, 0.55, 0.13, g); btn.rotation.x = Math.PI / 2; // the dusty INTERNET button
      const led = mesh(sph(0.018, 8, 6), basic(0x444444), -0.2, 0.53, 0.13, g);
      // a paper envelope that flies off when he sends a message
      const env = new THREE.Group(); env.visible = false; g.add(env);
      mesh(box(0.16, 0.1, 0.01), basic(0xfff6e0), 0, 0, 0, env);
      const flap = mesh(new THREE.ConeGeometry(0.08, 0.05, 3), basic(0xf0c27b), 0, 0.025, 0.006, env); flap.rotation.z = Math.PI; flap.scale.z = 0.1;
      let on = false, waiting = false, t0 = null;
      g.userData.act = (now, verb) => {
        if (t0 === null) t0 = now;
        const t = now - t0; // seconds since he started, so typing, sending and flying happen in order
        on = true; screenMat.color.set(0x1f6b4a);
        const typing = /write|type/.test(verb), reading = /read/.test(verb), button = /internet/.test(verb);
        key.position.y = 0.5 - (typing ? Math.abs(Math.sin(t * 22)) * 0.008 : 0);
        lines.forEach((l, i) => { const k = typing ? Math.min(1, Math.max(0, t * 1.2 - i)) : reading || !button ? 1 : 0; l.visible = k > 0; l.scale.x = Math.max(0.01, k); l.position.x = -0.02 - (1 - k) * 0.14; });
        cursor.visible = Math.sin(t * 8) > 0;
        btn.position.z = button ? 0.13 - Math.abs(Math.sin(t * 6)) * 0.01 : 0.13;
        if (button) screenMat.color.set(Math.sin(t * 6) > 0 ? 0x1f6b4a : 0x2a3a33);
        // after a little typing the message folds into an envelope and flies out of the screen and away
        const fly = typing ? (t - 3.6) / 2 : -1;
        env.visible = fly > 0 && fly < 1;
        if (fly > 0) { env.position.set(Math.sin(fly * 9) * 0.1, 0.75 + fly * 2.2, 0.2 + fly * 1.4); env.rotation.set(0, fly * 6, Math.sin(fly * 12) * 0.4); }
      };
      g.userData.rest = () => { t0 = null; env.visible = false; key.position.y = 0.5; btn.position.z = 0.13; update(); };
      function update() {
        screenMat.color.set(waiting ? 0x2f8f5b : on ? 0x1f6b4a : 0x2a3a33);
        led.material.color.set(on || waiting ? 0x7dff9e : 0x444444);
        lines.forEach((l, i) => { l.visible = on && i < 2; l.scale.x = 1; l.position.x = -0.02; });
        cursor.visible = on || waiting;
      }
      g.userData.blinkScreen = t => { if (waiting) screenMat.color.set(Math.sin(t * 4) > 0 ? 0x4fd18b : 0x1f6b4a); };
      return st => { on = st === 'on'; waiting = st === 'a message is waiting'; update(); };
    },
    door(g) {
      const pivot = new THREE.Group(); pivot.position.set(0, 0, -0.75); g.add(pivot);
      mesh(box(0.1, 2.2, 1.5), toon(0x8a5a3c), 0, 1.1, 0.75, pivot);
      mesh(sph(0.07, 10, 8), toon(0xe0a548), -0.1, 1.1, 1.3, pivot);
      const mat = mesh(box(0.9, 0.04, 1.3), toon(0x6f8f4e), -0.7, 0.02, 0, g);
      return st => { pivot.rotation.y = st === 'open' ? 1.3 : 0; void mat; };
    },
    field(g) { void g; return () => {}; },
    stone(g) {
      const s = mesh(new THREE.DodecahedronGeometry(0.7, 0), toon(0x9b958c), 0, 0.4, 0, g); s.scale.set(1.3, 0.75, 1);
      return () => {};
    },

    // ---- things that can be built after a wish ----
    artcorner(g) {
      mesh(box(3, 0.08, 2.4), toon(0xe6d3bf), 0, 0.04, 0, g);
      [[-0.35, 0.2], [0.35, 0.2], [0, -0.3]].forEach(([x, z]) => { const leg = mesh(cyl(0.04, 0.04, 1.9, 6), toon(0x9a6b4a), x * 0.9, 0.95, z, g); leg.rotation.x = z > 0 ? -0.15 : 0.25; });
      const canvasMat = toon(0xffffff);
      const canvas = mesh(box(1.1, 0.85, 0.05), canvasMat, 0, 1.45, 0.15, g);
      const paint = new THREE.Group(); g.add(paint); paint.position.set(0, 1.45, 0.19);
      [[0xc2473d, -0.25, 0.1, 0.18], [0x3b7dd8, 0.15, -0.1, 0.22], [0xe0a548, 0.2, 0.2, 0.12], [0x2f8f5b, -0.15, -0.2, 0.14]].forEach(([c, x, y, r]) => mesh(new THREE.CircleGeometry(r, 16), basic(c), x, y, 0, paint));
      mesh(box(0.5, 0.2, 0.3), toon(0x6a4fd8), 0.9, 0.18, 0.5, g);
      return st => { paint.visible = st === 'painted'; void canvas; };
    },
    cinema(g) {
      mesh(box(3.2, 2.6, 2.6), toon(0x6a4fd8), 0, 1.3, -0.3, g);
      mesh(box(3.4, 0.3, 2.8), toon(0xe0a548), 0, 2.7, -0.3, g);
      const screen = mesh(new THREE.PlaneGeometry(2.4, 1.3), basic(0x2a2433), 0, 1.4, 1.01, g);
      mesh(box(0.6, 0.5, 0.6), toon(0xc2473d), -1.1, 0.25, 1.6, g);
      const glow = new THREE.PointLight(0x9fd3ff, 0, 4, 2); glow.position.set(0, 1.4, 2); g.add(glow);
      return st => { const on = st === 'showing a film'; screen.material.color.set(on ? 0x9fd3ff : 0x2a2433); glow.intensity = on ? 0.5 : 0; };
    },
    hangout(g) {
      const roof = mesh(new THREE.ConeGeometry(2.2, 1.6, 4), toon(0x8a5a3c), 0, 2.6, -0.3, g); roof.rotation.y = Math.PI / 4;
      [[-1.3, -1.6], [1.3, -1.6], [-1.3, 1.0], [1.3, 1.0]].forEach(([x, z]) => mesh(cyl(0.08, 0.08, 1.9, 8), toon(0x7d5238), x, 0.95, z, g));
      const bag = mesh(sph(0.6, 20, 14), toon(0xd86ca8), 0, 0.35, -0.2, g); bag.scale.set(1.2, 0.6, 1.1);
      const lights = []; for (let i = 0; i < 9; i++) lights.push(mesh(sph(0.07, 8, 6), basic(0x777777), -1.3 + i * 0.325, 1.85 - Math.sin(i / 8 * Math.PI) * 0.25, 1.0, g));
      const pl = new THREE.PointLight(0xffe08a, 0, 4, 2); pl.position.set(0, 1.6, 0.4); g.add(pl);
      return st => { const on = st === 'lights on'; lights.forEach((l, i) => l.material.color.set(on ? [0xffe27a, 0xff9a8a, 0x9fd3ff][i % 3] : 0x777777)); pl.intensity = on ? 0.7 : 0; };
    },
    gamecorner(g) {
      mesh(box(1.1, 1.9, 0.9), toon(0x3b7dd8), 0, 0.95, 0, g);
      const scr = mesh(new THREE.PlaneGeometry(0.8, 0.6), basic(0x9fe6a0), 0, 1.45, 0.46, g);
      mesh(cyl(0.1, 0.1, 0.06, 16), toon(0xc2473d), 0, 1.0, 0.5, g).rotation.x = Math.PI / 2;
      g.userData.blink = scr; return () => {};
    },
    garden(g) {
      mesh(box(3, 0.3, 1.6), toon(0x7d5238), 0, 0.15, 0, g);
      const stems = [];
      for (let i = 0; i < 7; i++) {
        const f = new THREE.Group(); f.position.set(-1.2 + i * 0.4, 0.3, (i % 2) * 0.4 - 0.2); g.add(f);
        mesh(cyl(0.03, 0.03, 0.6, 6), toon(0x2f8f5b), 0, 0.3, 0, f);
        mesh(sph(0.13, 10, 8), toon([0xd86ca8, 0xe0a548, 0xc2473d, 0x6a4fd8][i % 4]), 0, 0.62, 0, f);
        stems.push(f);
      }
      return st => { stems.forEach((f, i) => { f.rotation.z = st === 'blooming' ? 0 : (i % 2 ? 0.6 : -0.6); f.scale.setScalar(st === 'blooming' ? 1.1 : 0.85); }); };
    },
    pond(g) {
      const w = mesh(new THREE.CircleGeometry(1.8, 40), toon(0x5fa8d3), 0, 0.03, 0, g); w.rotation.x = -Math.PI / 2;
      const rim = mesh(new THREE.RingGeometry(1.8, 2.1, 40), toon(0x9b958c), 0, 0.025, 0, g); rim.rotation.x = -Math.PI / 2;
      g.userData.water = w; return () => {};
    },
    friendhouse(g) {
      mesh(box(2.4, 1.8, 2.0), toon(0xf6e3b4), 0, 0.9, -0.2, g);
      const roof = mesh(new THREE.ConeGeometry(1.9, 1.1, 4), toon(0x3b7dd8), 0, 2.35, -0.2, g); roof.rotation.y = Math.PI / 4;
      mesh(box(0.6, 1.0, 0.06), toon(0x8a5a3c), 0, 0.5, 0.82, g);
      mesh(box(0.9, 0.03, 0.5), toon(0xc76b5a), 0, 0.02, 1.2, g);
      return () => {};
    },
    workshop(g, def) {
      if (def.id.startsWith('planboard')) {
        // The plan board stands beside the shed; pinned papers show when a plan is up.
        mesh(box(0.1, 1.3, 1.6), toon(0xc9a27a), 1.9, 1.05, 0.2, g);
        [[-0.5], [0.5]].forEach(([z]) => mesh(cyl(0.05, 0.05, 1.0, 6), toon(0x7d5238), 1.9, 0.5, 0.2 + z, g));
        const papers = new THREE.Group(); g.add(papers);
        [[0.45, -0.4, 0xffffff], [0.35, 0.1, 0xfff3b0], [-0.1, 0.45, 0xffffff], [-0.2, -0.25, 0xd6ecff]].forEach(([y, z, c]) => {
          const pp = mesh(new THREE.PlaneGeometry(0.42, 0.32), basic(c), 1.84, 1.05 + y * 0.9, 0.2 + z, papers); pp.rotation.y = -Math.PI / 2;
        });
        return st => { papers.visible = st !== 'empty'; papers.children.forEach((pp, i) => { pp.visible = st === 'a finished project is pinned up' || i < 2; }); };
      }
      // The shed: open at the front so you can see him working.
      const wood = toon(0xb07a4f), dark = toon(0x7d5238);
      mesh(box(3.0, 0.1, 2.4), toon(0xd9c3a5), 0, 0.05, -0.2, g);
      mesh(box(3.0, 2.2, 0.12), wood, 0, 1.1, -1.4, g);
      mesh(box(0.12, 2.2, 2.4), wood, -1.5, 1.1, -0.2, g);
      mesh(box(0.12, 2.2, 2.4), wood, 1.5, 1.1, -0.2, g);
      const roof = mesh(box(3.5, 0.14, 2.9), toon(0xc2473d), 0, 2.35, -0.2, g); roof.rotation.x = -0.12;
      sign('Workshop', g, -2.3, 1.3, 0.9);
      // Workbench with tiny tools.
      mesh(box(2.0, 0.1, 0.8), toon(0x9a6b4a), 0, 0.85, -0.85, g);
      [[-0.9, -1.15], [0.9, -1.15], [-0.9, -0.55], [0.9, -0.55]].forEach(([x, z]) => mesh(box(0.08, 0.8, 0.08), dark, x, 0.42, z, g));
      mesh(box(0.35, 0.06, 0.1), toon(0x9b958c), -0.5, 0.93, -0.8, g);
      mesh(cyl(0.03, 0.03, 0.4, 6), toon(0xe0a548), 0.3, 0.93, -0.75, g).rotation.z = Math.PI / 2;
      const mess = new THREE.Group(); g.add(mess);
      [[-0.2, -0.95, 0.3], [0.6, -0.7, -0.4], [0.05, -0.6, 0.9]].forEach(([x, z, r]) => { const pp = mesh(new THREE.PlaneGeometry(0.3, 0.22), basic(0xffffff), x, 0.91, z, mess); pp.rotation.x = -Math.PI / 2; pp.rotation.z = r; });
      const lamp = new THREE.PointLight(0xffe08a, 0, 4, 2); lamp.position.set(0, 1.9, -0.6); g.add(lamp);
      mesh(sph(0.12, 10, 8), basic(0xffe9a8), 0, 2.05, -0.6, g);
      return st => { mess.visible = st === 'messy'; lamp.intensity = st === 'messy' ? 0.6 : 0.25; };
    },
    // ---- presents from the wishmaster: each one can really be used ----
    blanket(g) {
      // lives on the bed; folded at the foot, or spread out over the whole bed
      const red = toon(0xc2473d), cream = toon(0xf6efe2);
      const folded = new THREE.Group(); folded.position.set(0.55, 0.22, 0); g.add(folded);
      [0, 1, 2].forEach(i => mesh(box(0.5, 0.05, 0.62), i % 2 ? cream : red, 0, 0.03 + i * 0.05, 0, folded));
      const spread = new THREE.Group(); g.add(spread);
      mesh(box(1.25, 0.05, 1.16), red, 0.18, 0.26, 0, spread);
      [-0.3, 0.1, 0.5].forEach(x => mesh(box(0.08, 0.052, 1.17), cream, x + 0.18, 0.262, 0, spread));
      return st => { folded.visible = st !== 'spread out'; spread.visible = st === 'spread out'; };
    },
    pebble(g) {
      const p = mesh(new THREE.DodecahedronGeometry(0.16, 1), toon(0x8d8a86), 0, 0.12, 0, g); p.scale.set(1.3, 0.7, 1);
      const shine = mesh(sph(0.04, 8, 6), basic(0xffffff), 0.08, 0.2, 0.1, g);
      g.userData.act = (t, verb) => { if (/roll/.test(verb)) { p.position.x = Math.sin(t * 3) * 0.6; p.rotation.z = -t * 6; } else p.rotation.y = t * 2; };
      g.userData.rest = () => { p.position.x = 0; };
      return st => { const sh = st === 'shiny'; p.material.color.set(sh ? 0xb8c4d6 : 0x8d8a86); shine.visible = sh; };
    },
    button(g) {
      const b = new THREE.Group(); b.position.y = 0.06; g.add(b);
      const disc = mesh(cyl(0.28, 0.28, 0.07, 28), toon(0x6fb7e0), 0, 0, 0, b);
      mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 24), toon(0x3b7dd8), 0, 0.04, 0, b).rotation.x = Math.PI / 2;
      [[-0.06, -0.06], [0.06, -0.06], [-0.06, 0.06], [0.06, 0.06]].forEach(([x, z]) => mesh(cyl(0.03, 0.03, 0.08, 8), toon(0x2a2433), x, 0.01, z, b));
      g.userData.act = (t, verb) => { if (/spin/.test(verb)) { b.rotation.y = t * 14; b.rotation.x = 1.4; b.position.y = 0.3; } else { b.rotation.x = 1.2; b.position.y = 0.32; b.rotation.y = 0.4; } };
      g.userData.rest = () => { b.rotation.set(0, 0, 0); b.position.y = 0.06; };
      void disc; return () => {};
    },
    string(g) {
      const segs = [];
      for (let i = 0; i < 9; i++) { const s = mesh(cyl(0.025, 0.025, 0.16, 6), toon(0xc2473d), -0.6 + i * 0.15, 0.03, 0, g); s.rotation.z = Math.PI / 2; segs.push(s); }
      const bow = new THREE.Group(); bow.position.set(0, 0.08, 0); g.add(bow);
      [-1, 1].forEach(sd => { const l = mesh(new THREE.TorusGeometry(0.12, 0.03, 6, 16), toon(0xc2473d), sd * 0.12, 0, 0, bow); l.scale.set(1, 0.6, 1); });
      g.userData.act = t => { segs.forEach((s, i) => { s.position.z = Math.sin(t * 9 + i * 0.8) * 0.12; s.position.y = 0.03 + Math.abs(Math.sin(t * 9 + i)) * 0.08; }); };
      g.userData.rest = () => segs.forEach((s, i) => { s.position.z = Math.sin(i * 0.9) * 0.06; s.position.y = 0.03; });
      g.userData.rest();
      return st => { const tied = st === 'tied in a bow'; bow.visible = tied; segs.forEach(s => { s.visible = !tied; }); };
    },
    leaf(g) {
      const l = new THREE.Group(); g.add(l);
      const blade = mesh(sph(0.3, 16, 10), toon(0x5aa05a), 0, 0.02, 0, l); blade.scale.set(1, 0.08, 0.5);
      mesh(box(0.56, 0.012, 0.02), toon(0x2f8f5b), 0, 0.05, 0, l);
      g.userData.act = (t, verb) => { if (/fan/.test(verb)) { l.position.y = 0.3; l.rotation.x = 1.2 + Math.sin(t * 12) * 0.5; } else { l.position.y = 0.25; l.rotation.x = 1.0; l.rotation.z = Math.sin(t * 2) * 0.2; } };
      g.userData.rest = () => { l.position.y = 0; l.rotation.set(0, 0.4, 0); };
      g.userData.rest();
      return () => {};
    },
    cap(g) {
      const c = new THREE.Group(); g.add(c);
      mesh(cyl(0.2, 0.2, 0.1, 20), toon(0xc2473d), 0, 0.05, 0, c);
      mesh(cyl(0.16, 0.16, 0.012, 20), toon(0xf6efe2), 0, 0.106, 0, c);
      g.userData.act = t => { c.rotation.y = t * 16; c.rotation.z = Math.sin(t * 8) * 0.15; };
      g.userData.rest = () => { c.rotation.set(0, 0, 0); };
      return st => { c.visible = st !== 'on his head'; };
    },
    cushion(g) {
      const c = mesh(sph(0.42, 24, 16), toon(0x6a4fd8), 0, 0.22, 0, g); c.scale.set(1, 0.5, 1);
      mesh(sph(0.06, 8, 6), toon(0xe0a548), 0, 0.43, 0, g);
      g.userData.act = (t, verb) => { if (/punch/.test(verb)) { const k = Math.abs(Math.sin(t * 10)); c.scale.set(1 + k * 0.25, 0.5 - k * 0.2, 1 + k * 0.25); c.position.x = -k * 0.1; } else c.scale.set(1.2, 0.35, 1.2); };
      g.userData.rest = () => { c.scale.set(1, 0.5, 1); c.position.x = 0; };
      return () => {};
    },
    broom(g) {
      const b = new THREE.Group(); b.position.set(0.3, 0, 0); g.add(b);
      const stick = mesh(cyl(0.03, 0.03, 1.1, 8), toon(0x9a6b4a), 0, 0.75, 0, b); void stick;
      mesh(cyl(0.08, 0.2, 0.28, 10), toon(0xe0c27b), 0, 0.14, 0, b);
      b.rotation.z = 0.2;
      const dust = [];
      [[-1.4, -0.4], [-2.2, 0.3], [-0.9, 0.8], [-2.8, -0.6], [-1.8, -1.1]].forEach(([x, z]) => { const d = mesh(sph(0.09, 8, 6), new THREE.MeshToonMaterial({ color: 0xb5ada3, gradientMap: grad, transparent: true, opacity: 0.85 }), x, 0.06, z, g); d.scale.y = 0.6; dust.push(d); });
      g.userData.act = t => { b.position.set(-0.2 + Math.sin(t * 7) * 0.35, 0, 0.2); b.rotation.z = Math.sin(t * 7) * 0.5; dust.forEach((d, i) => { d.scale.setScalar(Math.max(0.01, 1 - ((t * 0.6 + i * 0.13) % 1))); }); };
      g.userData.rest = () => { b.position.set(0.3, 0, 0); b.rotation.z = 0.2; dust.forEach(d => { d.scale.set(1, 0.6, 1); }); };
      return st => { dust.forEach(d => { d.visible = st === 'dusty floor'; }); };
    },
    giftbox(g) {
      const paper = toon(0x3b7dd8), ribbon = toon(0xe0a548);
      mesh(box(0.5, 0.4, 0.5), paper, 0, 0.2, 0, g);
      mesh(box(0.52, 0.41, 0.08), ribbon, 0, 0.2, 0, g); mesh(box(0.08, 0.41, 0.52), ribbon, 0, 0.2, 0, g);
      const lid = new THREE.Group(); lid.position.set(0, 0.42, 0); g.add(lid);
      mesh(box(0.56, 0.08, 0.56), paper, 0, 0, 0, lid);
      [-1, 1].forEach(sd => mesh(new THREE.TorusGeometry(0.08, 0.025, 6, 12), ribbon, sd * 0.08, 0.08, 0, lid));
      const star = mesh(new THREE.OctahedronGeometry(0.14, 0), toon(0xffd166), 0, 0.5, 0, g);
      g.userData.act = t => { star.position.y = 0.6 + Math.abs(Math.sin(t * 5)) * 0.3; star.rotation.y = t * 3; };
      g.userData.rest = () => { star.position.y = 0.5; };
      return st => { const open = st === 'unwrapped'; lid.position.set(open ? 0.45 : 0, open ? 0.05 : 0.42, open ? 0.2 : 0); lid.rotation.z = open ? 0.5 : 0; star.visible = open; };
    },
    custom(g, def) {
      const tent = mesh(new THREE.ConeGeometry(1.4, 2, 6), toon(0xe0a548), 0, 1, -0.3, g); void tent;
      mesh(sph(0.12, 10, 8), toon(0xc2473d), 0, 2.05, -0.3, g);
      sign(def.name, g, 1.5, 1.0, 0.8);
      return () => {};
    }
  };

  function addThing(def, x, z, spot, built) {
    const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
    if (built) g.rotation.y = 0;
    const update = (builders[def.kind] || builders.custom)(g, def);
    g.traverse(o => { o.userData.objId = def.id; });
    things[def.id] = { def, group: g, update, spot, built: !!built };
    update(S.objects[def.id] || def.state);
    return things[def.id];
  }

  // ---------- Secrets ----------
  // A glint floats over a secret he has noticed; what he found stays in the world afterwards.
  const SECRET_LOOK = {
    floorboard: [1.15, 0.06, 0.6, g => { const p = mesh(box(0.75, 0.04, 0.24), toon(0x8a5a3c), 0, 0, 0, g); p.rotation.z = 0.25; p.rotation.y = 0.4; }],
    marble: [1.45, 0.09, 0.85, g => { mesh(sph(0.09), toon(0x3b7dd8), 0, 0, 0, g); }],
    map: [0.55, 0.06, 0.75, g => { mesh(box(0.42, 0.01, 0.3), basic(0xf3e2b8), 0, 0, 0, g); [0.6, -0.6].forEach(r => { const x = mesh(box(0.12, 0.012, 0.025), basic(0xc2473d), 0.08, 0.002, 0.04, g); x.rotation.y = r; }); }],
    tinbox: [0.95, 0.06, 0.45, g => { const h = mesh(new THREE.CircleGeometry(0.22, 16), basic(0x5b4636), 0, -0.05, 0.1, g); h.rotation.x = -Math.PI / 2; const b = mesh(box(0.24, 0.12, 0.17), toon(0xb0b4b8), 0, 0, 0, g); b.rotation.y = 0.5; }],
    keyhole: [0.45, 2.69, 0.1, g => { mesh(box(0.22, 0.12, 0.16), toon(0xe0a548), 0, 0, 0, g); const lid = mesh(box(0.22, 0.02, 0.16), toon(0xe0a548), 0, 0.1, -0.09, g); lid.rotation.x = -1.1; }],
    underbed: [0.65, 0.06, 0.75, g => { mesh(cyl(0.07, 0.07, 0.02, 14), toon(0xd86ca8), 0, 0, 0, g); }],
    doormat: [-0.45, 0.05, 0.3, g => { const n = mesh(box(0.24, 0.01, 0.17), basic(0xffffff), 0, 0, 0, g); n.rotation.y = 0.3; }],
    clover: [0.4, 0.06, 0.9, g => { [[0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05]].forEach(([x, z]) => { const l = mesh(new THREE.CircleGeometry(0.055, 10), basic(0x2f8f5b), x, 0, z, g); l.rotation.x = -Math.PI / 2; }); }],
    beetles: [-0.85, 0.05, 0.35, g => { [[0, 0], [0.12, 0.08], [0.05, -0.1]].forEach(([x, z]) => mesh(sph(0.045, 8, 6), toon(0x2a2433), x, 0, z, g)); }],
  };
  const secretBits = {}; // id -> { glint, found }
  const glintGeo = new THREE.OctahedronGeometry(0.1, 0), glintMat = new THREE.MeshBasicMaterial({ color: 0xffe27a });
  function syncSecrets() {
    (world.secrets || []).forEach(x => {
      const th = things[x.object]; if (!th) return;
      const st = S.secrets[x.id];
      let bits = secretBits[x.id];
      if (!bits) {
        const look = SECRET_LOOK[x.id] || [0, 0, 0.6, null];
        const glint = mesh(glintGeo, glintMat, look[0], Math.max(0.6, look[1] + 0.5), look[2], th.group);
        let found = null;
        if (look[3]) { found = new THREE.Group(); found.position.set(look[0], look[1], look[2]); th.group.add(found); look[3](found); }
        bits = secretBits[x.id] = { glint, found, base: glint.position.y };
      }
      bits.glint.visible = st === 'noticed';
      if (bits.found) bits.found.visible = st === 'found';
    });
  }

  // Where he stands to use each thing.
  const SPOT = { bed: [-2.0, -0.6], shelf: [-1.0, -1.3], rug: [0, 0.4], window: [1.6, -1.4], lamp: [2.4, -1.3], ball: [-0.8, 1.6], doorstep: [3.7, 0.6], computer: [-3.25, 1.6], field: [9, 0.6], stone: [6.5, 2.4] };
  const PLACE = { home: 'In his house', outside: 'Outside' };

  // Empty plots outside: a stake and a little sign, until something is built there.
  const plotMarkers = [];
  function buildPlots() {
    world.plots.forEach(([x, z], i) => {
      const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
      const m = toon(0xf6efe2);
      [[-1.3, -1.1], [1.3, -1.1], [-1.3, 1.1], [1.3, 1.1]].forEach(([px, pz]) => mesh(cyl(0.05, 0.05, 0.5, 6), m, px, 0.25, pz, g));
      const outline = mesh(new THREE.RingGeometry(1.75, 1.85, 4), basic(0xf6efe2), 0, 0.03, 0, g); outline.rotation.x = -Math.PI / 2; outline.rotation.z = Math.PI / 4;
      if (i < 2) sign('Room for a wish', g, 0, 0.8, 1.3);
      plotMarkers.push(g);
    });
  }

  // Presents live inside his house: the wishmaster's free things have their own place and model,
  // anything else Frederik gave him arrives as a gift box.
  function giftId(item) {
    const g = (world.gifts || []).find(x => x.item === item);
    if (g) return g.id;
    return 'gift-' + item.toLowerCase().replace(/[^a-z0-9' -]/g, ' ').trim().replace(/^(a|an|some|the)\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  }
  function syncGifts() {
    let spare = 0;
    (S.items || []).forEach(item => {
      const id = giftId(item);
      if (things[id]) return;
      const def = (world.gifts || []).find(x => x.item === item);
      let o, pos, spot;
      if (def) { o = Object.assign({}, def, { area: 'home' }); pos = def.pos; spot = def.spot; }
      else {
        const cg = world.customGift || { kind: 'giftbox', desc: '', state: 'wrapped', actions: [] };
        o = { id, name: item.replace(/^(a|an|some|the)\s+/i, ''), kind: cg.kind, state: cg.state, desc: cg.desc, actions: cg.actions, area: 'home' };
        const spots = world.giftSpots || [[0, 2]];
        while (Object.values(things).some(th => th.giftSpot === spare)) spare++;
        pos = spots[spare % spots.length]; o.giftSpot = spare;
      }
      if (!spot) spot = [pos[0] + (pos[0] > 0 ? -0.7 : 0.7), pos[1] + (pos[1] > 0 ? -0.5 : 0.5)];
      const th = addThing(o, pos[0], pos[1], spot);
      th.group.position.y = o.y || 0;
      if (o.giftSpot !== undefined) th.giftSpot = o.giftSpot;
      if (!reduce && !first) th.popIn = 0;
    });
  }

  function syncBuilt() {
    (S.built || []).forEach(b => {
      const plot = world.plots[b.plot % world.plots.length] || [10 + b.plot * 4.5, -3.5];
      if (plotMarkers[b.plot]) plotMarkers[b.plot].visible = false;
      const def = world.buildables.find(x => x.id === b.buildable);
      const items = def ? def.objects.map(o => ({ id: S.built.filter(x => x.buildable === def.id).indexOf(b) > 0 ? o.id + '-' + b.id : o.id, name: o.name, kind: def.kind, state: o.state, desc: o.desc, actions: o.actions, area: 'outside' }))
        : [{ id: b.id, name: b.name, kind: 'custom', state: 'new', desc: world.custom.desc, actions: world.custom.actions, area: 'outside' }];
      items.forEach(o => {
        if (things[o.id]) return;
        const side = plot[1] < 0 ? 1 : -1;  // face the path
        const t = addThing(o, plot[0], plot[1], [plot[0], plot[1] + side * 2.0], true);
        t.group.rotation.y = side > 0 ? 0 : Math.PI;
        if (!reduce) t.popIn = 0;
      });
    });
  }

  // ---------- Lil guy ----------
  const holder = new THREE.Group(); holder.scale.setScalar(0.42); scene.add(holder);
  const shadow = mesh(new THREE.CircleGeometry(0.9, 40), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 }), 0, 0.05, 0, holder);
  shadow.rotation.x = -Math.PI / 2;
  const guy = new THREE.Group(); holder.add(guy);
  const geo = new THREE.SphereGeometry(1, 64, 64);
  const pos = geo.attributes.position; const base = pos.array.slice();
  const spikes = []; const N = 34;
  for (let i = 0; i < N; i++) { const y = 1 - (i + 0.5) * 2 / N, r = Math.sqrt(1 - y * y), t = i * Math.PI * (3 - Math.sqrt(5)); spikes.push([Math.cos(t) * r, y, Math.sin(t) * r]); }
  const bodyMat = toon(0xffc857);
  const body = new THREE.Mesh(geo, bodyMat); guy.add(body);
  body.userData.isGuy = true;
  const fc = document.createElement('canvas'); fc.width = fc.height = 512; const fx = fc.getContext('2d');
  const faceTex = new THREE.CanvasTexture(fc);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 1.45), new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, depthWrite: false }));
  guy.add(face);
  const limbMat = toon(0x2a2433);
  function arm(side) {
    const g = new THREE.Group();
    mesh(cyl(0.05, 0.05, 0.34, 10), limbMat, 0, -0.17, 0, g);
    mesh(sph(0.11, 16, 16), limbMat, 0, -0.36, 0, g);
    g.userData.side = side; guy.add(g); return g;
  }
  const armL = arm(-1), armR = arm(1);
  function leg() {
    const g = new THREE.Group();
    mesh(cyl(0.055, 0.055, 0.22, 10), limbMat, 0, -0.11, 0, g);
    const foot = mesh(sph(0.12, 16, 12), limbMat, 0, -0.23, 0.05, g); foot.scale.set(1.3, 0.6, 1.6);
    guy.add(g); return g;
  }
  const legL = leg(), legR = leg();
  // his bottle cap hat, worn on top when he puts it on
  const hat = new THREE.Group(); guy.add(hat);
  mesh(cyl(0.5, 0.5, 0.24, 24), toon(0xc2473d), 0, 0.12, 0, hat);
  mesh(cyl(0.4, 0.4, 0.02, 24), toon(0xf6efe2), 0, 0.25, 0, hat);
  hat.rotation.z = -0.25; hat.visible = false;
  const zzz = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshBasicMaterial({ map: labelTexture('Zzz', 'rgba(0,0,0,0)', '#6a4fd8'), transparent: true, depthWrite: false }));
  zzz.position.set(0.9, 2.2, 0); holder.add(zzz);

  // A little thought symbol over his head (?, !, a heart, a star, a lightbulb, a raincloud, a note).
  const symCanvas = document.createElement('canvas'); symCanvas.width = symCanvas.height = 256; const sx = symCanvas.getContext('2d');
  const symTex = new THREE.CanvasTexture(symCanvas);
  const sym = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: symTex, transparent: true, depthWrite: false }));
  sym.position.set(0.75, 2.35, 0); sym.visible = false; holder.add(sym);
  const SYM = { until: 0, shownAt: 0, ch: '' };
  function drawSymbol(ch) {
    sx.clearRect(0, 0, 256, 256);
    sx.fillStyle = 'rgba(255,255,255,0.92)'; sx.strokeStyle = 'rgba(42,36,51,0.18)'; sx.lineWidth = 6;
    sx.beginPath(); sx.arc(128, 116, 92, 0, Math.PI * 2); sx.fill(); sx.stroke();
    sx.beginPath(); sx.arc(70, 214, 16, 0, Math.PI * 2); sx.fill(); sx.beginPath(); sx.arc(44, 240, 9, 0, Math.PI * 2); sx.fill();
    const ink = '#2a2433';
    if (ch === 'cloud') {
      sx.fillStyle = '#8fa7d6'; [[98, 112, 34], [140, 100, 42], [176, 120, 28], [128, 128, 34]].forEach(([x, y, r]) => { sx.beginPath(); sx.arc(x, y, r, 0, Math.PI * 2); sx.fill(); });
      sx.strokeStyle = '#3b7dd8'; sx.lineWidth = 8; sx.lineCap = 'round'; [[100, 160], [130, 170], [160, 160]].forEach(([x, y]) => { sx.beginPath(); sx.moveTo(x, y); sx.lineTo(x - 6, y + 20); sx.stroke(); });
    } else if (ch === 'heart') {
      sx.fillStyle = '#e8577a'; sx.beginPath(); sx.moveTo(128, 170); sx.bezierCurveTo(40, 110, 80, 40, 128, 84); sx.bezierCurveTo(176, 40, 216, 110, 128, 170); sx.fill();
    } else if (ch === 'star') {
      sx.fillStyle = '#f5b82e'; sx.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 30 : 70, a = -Math.PI / 2 + i * Math.PI / 5; sx.lineTo(128 + Math.cos(a) * r, 118 + Math.sin(a) * r); }
      sx.closePath(); sx.fill();
    } else if (ch === 'bulb') {
      sx.fillStyle = '#ffd23f'; sx.beginPath(); sx.arc(128, 100, 46, 0, Math.PI * 2); sx.fill();
      sx.fillStyle = '#b0b4b8'; sx.fillRect(108, 140, 40, 30); sx.strokeStyle = ink; sx.lineWidth = 6; sx.beginPath(); sx.moveTo(110, 152); sx.lineTo(146, 152); sx.stroke();
    } else {
      sx.fillStyle = ch === '!' ? '#e8577a' : ch === '?' ? '#6a4fd8' : ink;
      sx.font = '700 128px Fredoka, Trebuchet MS, sans-serif'; sx.textAlign = 'center'; sx.textBaseline = 'middle';
      sx.fillText(ch, 128, 122);
    }
    symTex.needsUpdate = true;
  }
  function showSymbol(ch, ms) {
    if (SYM.ch !== ch) { drawSymbol(ch); SYM.ch = ch; }
    SYM.shownAt = performance.now(); SYM.until = SYM.shownAt + (ms || 2600);
  }

  // Tiny sounds, made in the browser (no files). Off unless the visitor turns them on.
  let audio = null, soundOn = false;
  try { soundOn = localStorage.getItem('lilguy-sound') === '1'; } catch (e) {}
  const soundBtn = $('sound');
  function ensureAudio() { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (e) { audio = null; } return audio; }
  const TUNES = { boop: [[520, 0.08]], hi: [[660, 0.07], [880, 0.09]], find: [[660, 0.07], [880, 0.07], [1170, 0.14]], oops: [[520, 0.1], [330, 0.18]],
    happy: [[700, 0.06], [930, 0.06], [700, 0.06], [1050, 0.12]], hum: [[440, 0.14], [494, 0.14], [523, 0.2]], yawn: [[480, 0.3], [300, 0.35]] };
  function chirp(kind) {
    if (!soundOn || document.hidden) return;
    const a = ensureAudio(); if (!a) return;
    let at = a.currentTime + 0.01;
    for (const [f, d] of TUNES[kind] || []) {
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(f, at); o.frequency.exponentialRampToValueAtTime(f * 1.12, at + d);
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.1, at + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, at + d);
      o.connect(g); g.connect(a.destination); o.start(at); o.stop(at + d + 0.03); at += d * 0.9;
    }
  }
  if (soundBtn) {
    soundBtn.setAttribute('aria-pressed', String(soundOn));
    soundBtn.addEventListener('click', () => {
      soundOn = !soundOn; soundBtn.setAttribute('aria-pressed', String(soundOn));
      try { localStorage.setItem('lilguy-sound', soundOn ? '1' : '0'); } catch (e) {}
      if (soundOn) chirp('hi');
    });
  }

  // His own colour: the favourite he picked, matched from his words. Moods only tint it.
  const COLOURS = { dandelion: 0xffd23f, sunflower: 0xffcf3a, sunny: 0xffcf4a, lemon: 0xfde36a, butter: 0xffe08a, honey: 0xf5b84a, yellow: 0xffc857, gold: 0xf5b82e, golden: 0xf5b82e,
    mango: 0xffa94d, tangerine: 0xff9a3d, orange: 0xffa94d, apricot: 0xffb27a, peach: 0xffb88c, coral: 0xff8a73, tomato: 0xf26b5b, cherry: 0xe8505b, strawberry: 0xf2606f, red: 0xf26b5b,
    bubblegum: 0xff9ec4, pink: 0xff9ec4, rose: 0xf28bb0, plum: 0xa0679e, purple: 0xb18cf0, lavender: 0xc4b0f0, lilac: 0xc9a8e8, violet: 0xa57be8,
    sky: 0x6cc4ff, blue: 0x5fa8f5, ocean: 0x5fa3d8, sea: 0x5fb6c8, teal: 0x4fc1b5, turquoise: 0x4fd1c5, mint: 0x9be3c3, green: 0x7fcf72, leaf: 0x7fcf72, grass: 0x8fd46a, moss: 0x8fb85a, frog: 0x7fc45a, lime: 0xb6e05a,
    cocoa: 0xb08360, brown: 0xc79a6b, cream: 0xf6e3b4, sand: 0xe6cf9e, white: 0xf3efe8, cloud: 0xf3efe8, grey: 0xb9b4c2, gray: 0xb9b4c2, silver: 0xc7c9d1 };
  let sigWords = null, sigColour = null;
  function signatureColour() {
    const words = S.self && S.self.colour ? S.self.colour.toLowerCase() : '';
    if (words === sigWords) return sigColour;
    sigWords = words; sigColour = null;
    for (const w of words.split(/[^a-z]+/)) if (COLOURS[w] !== undefined) { sigColour = new THREE.Color(COLOURS[w]); break; }
    return sigColour;
  }
  const TINT = { content: 0, curious: 0.12, proud: 0, lonely: 0.5, feisty: 0.45, sleepy: 0.4 };
  const tmpColour = new THREE.Color();

  function moods() {
    const n = S.needs;
    const sleepy = S.sleeping ? 1 : clamp((0.3 - n.energy) / 0.3);
    return { lonely: clamp((0.4 - n.company) / 0.4), feisty: clamp((n.feisty - 0.45) / 0.55), sleepy, curious: clamp((n.curiosity - 0.5) / 0.5) * (1 - sleepy) };
  }
  const palette = { content: new THREE.Color(0xffc857), curious: new THREE.Color(0xffb347), lonely: new THREE.Color(0x8fa7d6), feisty: new THREE.Color(0xff7a6b), sleepy: new THREE.Color(0xb9a8e0), proud: new THREE.Color(0xffd23f) };
  const W = { s: 1, c: 0, k: 0, d: 0 };
  const F = { open: 1, size: 1, brow: 0, curve: 0.5, mouthOpen: 0.1, look: 0, lookY: 0, blink: 0, grin: 0, blush: 0, wow: 0, wobble: 0, dizzy: 0 };
  let lastW = '';
  function deform() {
    const key = [W.s, W.c, W.k, W.d].map(v => v.toFixed(3)).join();
    if (key === lastW) return; lastW = key;
    const a = pos.array;
    for (let i = 0; i < a.length; i += 3) {
      const x = base[i], y = base[i + 1], z = base[i + 2];
      const n = Math.pow(Math.pow(Math.abs(x), 8) + Math.pow(Math.abs(y), 8) + Math.pow(Math.abs(z), 8), 1 / 8);
      let m = 0; for (let j = 0; j < N; j++) { const s = spikes[j]; const d = x * s[0] + y * s[1] + z * s[2]; if (d > m) m = d; }
      const spike = clamp((m - 0.935) / 0.065) * 0.75 * clamp((0.55 - z) / 0.3);
      const r = W.s + W.c * (0.84 / n) + W.k * (1 + spike);
      const sag = 1 - W.d * 0.18 * clamp(y);
      const pear = 1 + 0.05 * clamp(-y); // a little bottom-heavy, so he sits and squashes nicely
      a[i] = x * r * pear * (1 + W.d * 0.12); a[i + 1] = y * r * sag * 0.97; a[i + 2] = z * r * pear * (1 + W.d * 0.08);
    }
    pos.needsUpdate = true; geo.computeVertexNormals();
  }
  function drawFace() {
    fx.clearRect(0, 0, 512, 512);
    // Big eyes set low on the face, like a baby animal's: that is most of his charm.
    const ink = '#2a2433', eyeY = 262 - F.lookY * 12, gap = 100, lx = 256 - gap + F.look * 22, rx = 256 + gap + F.look * 22;
    const open = clamp(F.open * (1 - F.blink)), sz = F.size * 1.4 * (1 + F.wow * 0.12);
    fx.strokeStyle = ink; fx.fillStyle = ink; fx.lineCap = 'round';
    for (const ex of [lx, rx]) {
      if (F.dizzy > 0.5) { fx.lineWidth = 14; const r = 26 * F.size; fx.beginPath(); fx.moveTo(ex - r, eyeY - r); fx.lineTo(ex + r, eyeY + r); fx.moveTo(ex + r, eyeY - r); fx.lineTo(ex - r, eyeY + r); fx.stroke(); continue; }
      if (F.grin > 0.5 && open >= 0.2) { fx.lineWidth = 16; fx.beginPath(); fx.arc(ex, eyeY + 18, 32 * F.size, 1.15 * Math.PI, 1.85 * Math.PI); fx.stroke(); continue; }
      if (open < 0.2) { fx.lineWidth = 14; fx.beginPath(); fx.arc(ex, eyeY - 8, 32 * F.size, 0.15 * Math.PI, 0.85 * Math.PI); fx.stroke(); continue; }
      fx.beginPath(); fx.ellipse(ex, eyeY, 30 * sz, Math.max(5, 42 * sz * open), 0, 0, Math.PI * 2); fx.fill();
      if (open > 0.35) {
        fx.fillStyle = '#fff';
        fx.beginPath(); fx.arc(ex + 11 * sz, eyeY - 15 * sz, 11 * sz, 0, Math.PI * 2); fx.fill();
        fx.beginPath(); fx.arc(ex - 10 * sz, eyeY + 14 * sz, 4.5 * sz, 0, Math.PI * 2); fx.fill();
        fx.fillStyle = ink;
      }
    }
    if (Math.abs(F.brow) > 0.05) {
      fx.lineWidth = 13;
      for (const [ex, dir] of [[lx, 1], [rx, -1]]) { fx.beginPath(); fx.moveTo(ex - 32, eyeY - 88 + F.brow * 18 * dir); fx.lineTo(ex + 32, eyeY - 88 - F.brow * 18 * dir); fx.stroke(); }
    }
    fx.fillStyle = 'rgba(255,110,120,' + (0.32 + F.blush * 0.35).toFixed(2) + ')';
    for (const ex of [lx - 40, rx + 40]) { fx.beginPath(); fx.ellipse(ex, eyeY + 74, 34, 18, 0, 0, Math.PI * 2); fx.fill(); }
    const my = 372, w = 50;
    fx.lineWidth = 12; fx.fillStyle = ink;
    if (F.wow > 0.35) { fx.beginPath(); fx.ellipse(256, my + 6, 18 + F.wow * 6, 12 + F.wow * 18, 0, 0, Math.PI * 2); fx.fill(); }
    else if (F.wobble > 0.35) {
      fx.beginPath(); fx.moveTo(256 - w, my + 8);
      for (let i = 1; i <= 8; i++) fx.lineTo(256 - w + i * (w * 2 / 8), my + 8 + (i % 2 ? -7 : 7) * F.wobble);
      fx.stroke();
    } else {
      const c = F.curve * 42;
      fx.beginPath(); fx.moveTo(256 - w, my); fx.quadraticCurveTo(256, my + c, 256 + w, my);
      if (F.mouthOpen > 0.15) { fx.quadraticCurveTo(256, my + c + F.mouthOpen * 56, 256 - w, my); fx.fill(); }
      fx.stroke();
    }
    faceTex.needsUpdate = true;
  }

  // ---------- Little reactions ----------
  // One at a time: a tumble when a try goes wrong, a double-take on a secret, a happy wiggle, idle fidgets.
  const R = { kind: '', t0: 0, until: 0 };
  function react(kind, ms) { R.kind = kind; R.t0 = performance.now(); R.until = R.t0 + ms; }
  const FIDGETS = ['look', 'tap', 'scratch', 'hum', 'yawn'];

  // ---------- Walking ----------
  // He walks along waypoints; going in or out goes through the door.
  const DOOR_IN = [3.6, 0.6], DOOR_OUT = [5.6, 0.6];
  const inside = p => p[0] < HOUSE.x1 && p[0] > HOUSE.x0 && p[1] > HOUSE.z0 && p[1] < HOUSE.z1;
  let gx = 0, gz = 0.4, route = [], facing = 0, actUntil = 0, actPending = 0, actTarget = null, actVerb = '';
  const LIE = /^(nap|snuggle)/;
  function startAct(object, verb, line) {
    Object.values(things).forEach(th => { if (th.group.userData.rest) th.group.userData.rest(); });
    actTarget = object; actVerb = verb || ''; actUntil = 0; actPending = LIE.test(actVerb) ? 12000 : object === 'computer' && /write/.test(actVerb) ? 6500 : 5000; // starts once he has walked there
    if (line) toast(line);
    if (/^oops$/.test(actVerb)) { actPending = 0; react('oops', 1500); showSymbol('!?', 2200); chirp('oops'); }
    else chirp('boop');
  }
  let windUpUntil = 0;
  function walkTo(p) {
    const from = [gx, gz];
    windUpUntil = performance.now() + (reduce ? 0 : 320); // a little wind-up before he sets off
    route = [];
    if (inside(from) && !inside(p)) route.push(DOOR_IN, DOOR_OUT);
    else if (!inside(from) && inside(p)) route.push(DOOR_OUT, DOOR_IN);
    route.push(p);
  }
  // The blanket over him when he lies in bed: his red present if he has it, otherwise the bed's own.
  let coverMesh = null;
  function coverFor() {
    if (!things.bed) return null;
    if (!coverMesh) {
      coverMesh = mesh(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xf0c27b), 0.28, 0.2, 0, things.bed.group);
      coverMesh.scale.set(0.62, 0.42, 0.6);
      coverMesh.userData.objId = 'bed';
    }
    const gift = (S.items || []).includes('a warm blanket');
    coverMesh.material.color.set(gift ? 0xc2473d : 0xf0c27b);
    if (gift) coverMesh.userData.objId = 'blanket';
    return coverMesh;
  }
  function spotOf(id) { const t = things[id]; return t ? t.spot : SPOT[id] || null; }

  // Put the camera behind him at a distance that suits the screen shape.
  function snapCamera() {
    const far = camera.aspect < 0.8 ? 1.55 : camera.aspect < 1.2 ? 1.25 : 1;
    controls.target.set(gx, 0.6, gz);
    camera.position.set(gx + 0.8 * far, 6.5 * far, gz + 10.5 * far);
    controls.update();
  }

  // ---------- Applying live state ----------
  let lastAt = null, tickSeconds = 180, lastThought = '', lastActAt = null, first = true;
  function apply(d) {
    if (!d || !d.needs) return;
    S.needs = d.needs; S.sleeping = !!d.sleeping; S.mood = d.mood || 'content';
    S.objects = d.objects || {}; S.built = d.built || []; S.uses = d.uses || {}; S.items = d.items || []; S.wishes = d.wishes || []; S.projects = d.projects || [];
    const prevSecrets = S.secrets || {}, prevMood = S.mood;
    S.secrets = d.secrets || {}; S.wonder = d.wonder || null; S.self = d.self || null;
    if (!first) {
      const changed = Object.keys(S.secrets).filter(k => S.secrets[k] !== prevSecrets[k]);
      if (changed.some(k => S.secrets[k] === 'found')) { react('doubletake', 1800); showSymbol('!', 3000); chirp('find'); }
      else if (changed.length) showSymbol('!', 2600);
      const newest = (d.highlights || [])[(d.highlights || []).length - 1];
      if (newest && newest.at !== S.lastHighlight) {
        if (newest.kind === 'theory') showSymbol('bulb', 3200);
        else if (newest.kind === 'ritual') showSymbol('heart', 3200);
        else if (newest.kind === 'goal') { showSymbol('star', 4000); react('wiggle', 1800); chirp('happy'); }
        else if (newest.kind === 'no') react('sad', 3000);
      }
      if (S.mood === 'proud' && prevMood !== 'proud' && R.kind !== 'doubletake') { react('wiggle', 1700); showSymbol('star', 3000); chirp('happy'); }
    }
    const hl = d.highlights || []; S.lastHighlight = hl.length ? hl[hl.length - 1].at : S.lastHighlight;
    if (world) { syncBuilt(); syncGifts(); syncSecrets(); }
    Object.values(things).forEach(t => t.update(S.objects[t.def.id] || t.def.state));

    const place = S.sleeping ? 'bed' : d.place;
    const spot = spotOf(place) || SPOT.rug;
    if (first) { gx = spot[0]; gz = spot[1]; route = []; snapCamera(); }
    else if (place !== S.place) walkTo(spot);
    S.place = place;

    if (d.last && d.last.at !== lastActAt) {
      if (!first) startAct(d.last.object, d.last.verb, d.last.line);
      lastActAt = d.last.at;
    }
    first = false;
    lastAt = d.at; tickSeconds = d.tickSeconds || 180;

    NEEDS.forEach(([k]) => { const v = Math.round(clamp(d.needs[k] || 0) * 100); $('b-' + k).style.width = v + '%'; $('m-' + k).style.width = v + '%'; $('o-' + k).textContent = v + '%'; });
    const t = things[place];
    const where = d.paused ? 'Paused' : (t ? (t.def.area === 'outside' ? 'Outside, by the ' : 'At the ') + t.def.name : 'In his house');
    const moodText = cap(S.sleeping ? 'asleep' : S.mood);
    $('placeChip').textContent = where; $('moodChip').textContent = moodText;
    $('fWhere').textContent = where; $('fMood').textContent = moodText; $('fShape').textContent = cap(d.shape || 'ball');
    $('fTicks').textContent = String(d.ticks || 0);
    const w = S.wonder;
    $('fWonder').textContent = w ? (w.answer ? w.text + ' He found out: ' + w.answer : w.text) : 'Not picked yet today';
    const nFound = Object.values(S.secrets).filter(v => v === 'found').length, nAll = (world && world.secrets || []).length;
    $('fSecrets').textContent = nAll ? nFound + ' of ' + nAll : String(nFound);

    renderLists();
    renderHighlights(d);
    const list = $('diary'); list.textContent = '';
    const entries = (d.diary || []).slice().reverse();
    if (!entries.length) list.innerHTML = '<li><time></time><span class="empty">Nothing has happened yet.</span></li>';
    entries.forEach(e => { const li = document.createElement('li'); const tm = document.createElement('time'); tm.dateTime = e.at; tm.textContent = hhmm(e.at); const s = document.createElement('span'); s.textContent = e.text; li.append(tm, s); list.append(li); });

    const thought = S.sleeping ? 'Zzz...' : (d.thought || '');
    if (thought !== lastThought) { lastThought = thought; say(thought); }
    updateLive();
    if (openThing) showThing(openThing);
  }

  function li(text, right, onClick) {
    const el = document.createElement('li');
    const a = document.createElement(onClick ? 'button' : 'span'); a.textContent = text; if (onClick) a.addEventListener('click', onClick);
    el.append(a);
    if (right) { const r = document.createElement('span'); r.textContent = right; el.append(r); }
    return el;
  }
  function renderLists() {
    const bl = $('builtList'); bl.textContent = '';
    if (!S.built.length) bl.append(li('Nothing yet. The land outside is empty.'));
    S.built.forEach(b => bl.append(li(cap(b.name), 'built ' + new Date(b.at).toLocaleDateString(), () => focusOn(b.buildable ? (world.buildables.find(x => x.id === b.buildable) || {}).objects[0].id : b.id))));
    const pl = $('projList'); pl.textContent = '';
    if (!S.projects.length) pl.append(li('None yet. When he has an idea, Frederik has to say yes first.'));
    S.projects.slice().reverse().forEach(p => {
      const right = p.status === 'working' ? p.done + ' of ' + p.steps.length + ' steps' : p.status;
      const item = li(cap(p.title), right, () => showProject(p));
      pl.append(item);
    });
    const wl = $('wishList'); wl.textContent = '';
    if (!S.wishes.length) wl.append(li('None right now.'));
    S.wishes.forEach(w => wl.append(li(cap(w))));
    const th = $('things'); th.textContent = '';
    if (!S.items.length) th.innerHTML = '<p class="empty">Nothing yet.</p>';
    S.items.forEach(t => { const c = document.createElement('span'); c.className = 'chip'; c.textContent = t; th.append(c); });
    const ol = $('objList'); ol.textContent = '';
    Object.values(things).filter(t => t.def.kind !== 'field').forEach(t => ol.append(li(cap(t.def.name), S.objects[t.def.id] || t.def.state, () => focusOn(t.def.id))));
  }

  // ---------- Highlights: only the moments worth remembering ----------
  const HL_ICON = { project: '\ud83d\udee0\ufe0f', first: '\u2728', wish: '\ud83c\udf20', yes: '\ud83c\udf89', no: '\u2601\ufe0f', built: '\ud83d\udd28', mood: '\ud83d\udcad', chat: '\ud83d\udcac', gift: '\ud83c\udf81', secret: '\ud83d\udddd\ufe0f', wonder: '\ud83e\udd14', theory: '\ud83d\udca1', self: '\ud83c\udf1f', goal: '\ud83c\udf1f', ritual: '\ud83c\udf3f', oops: '\ud83d\ude35' };
  const HL_BIG = { built: 1, yes: 1, wish: 1, project: 1, secret: 1, wonder: 1, goal: 1 };
  // Until his server sends highlights, pick them out of the recent diary.
  function guessHighlights(diary) {
    const out = [];
    (diary || []).forEach(e => {
      const t = e.text;
      if (/for the first time!$/.test(t)) out.push({ at: e.at, kind: 'first', text: t.replace(/ for the first time!$/, '').replace(/^Went/, 'First time: went') + '.' });
      else if (/ \(new!\)$/.test(t) && !/^(Tried|Looked closely)/.test(t)) out.push({ at: e.at, kind: 'first', text: 'First time: ' + t.replace(/ \(new!\)$/, '') });
      else if (/^Wished for .+ The wishmaster gave him /.test(t)) out.push({ at: e.at, kind: 'gift', text: t.replace(/:.*$/, '.') });
      else if (/^Wished for .+ The wishmaster asked Frederik/.test(t)) out.push({ at: e.at, kind: 'wish', text: t.replace(/ The wishmaster asked Frederik\./, '') });
      else if (/he is now a (spiky ball|cube)/.test(t)) out.push({ at: e.at, kind: 'mood', text: /cube/.test(t) ? 'Felt lonely and turned into a cube.' : 'Got feisty and turned into a spiky ball.' });
    });
    return out;
  }
  function dayName(iso) {
    const d = new Date(iso), now = new Date();
    const key = x => x.getFullYear() + '-' + x.getMonth() + '-' + x.getDate();
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (key(d) === key(now)) return 'Today';
    if (key(d) === key(y)) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
  }
  function renderHighlights(d) {
    const list = $('highlights'); list.textContent = '';
    const items = (d.highlights && d.highlights.length ? d.highlights : guessHighlights(d.diary)).slice().reverse();
    if (!items.length) { list.innerHTML = '<li class="empty">Nothing big has happened yet. He is still finding his feet.</li>'; return; }
    let lastDay = '';
    items.forEach(h => {
      const day = dayName(h.at);
      if (day !== lastDay) { const li = document.createElement('li'); li.className = 'day'; li.textContent = day; list.append(li); lastDay = day; }
      const li = document.createElement('li'); li.className = 'moment' + (HL_BIG[h.kind] ? ' big' : '');
      const i = document.createElement('i'); i.textContent = HL_ICON[h.kind] || '\u2728'; i.setAttribute('aria-hidden', 'true');
      const div = document.createElement('div');
      const p = document.createElement('p'); p.textContent = h.text;
      const tm = document.createElement('time'); tm.dateTime = h.at; tm.textContent = hhmm(h.at);
      div.append(p, tm); li.append(i, div); list.append(li);
    });
  }

  function updateLive() {
    const el = $('live'), txt = $('liveText');
    el.className = 'live';
    if (!lastAt) { txt.textContent = 'Not connected yet'; return; }
    const age = Date.now() - new Date(lastAt).getTime();
    $('fHeard').textContent = timeAgo(age);
    if (age < (tickSeconds * 2 + 90) * 1000) { el.classList.add('on'); txt.textContent = 'Live'; }
    else { el.classList.add('stale'); txt.textContent = 'Away'; }
  }

  // ---------- Tapping things ----------
  let openThing = null, focusPoint = null;
  function showThing(id) {
    const t = things[id]; if (!t) return;
    openThing = id;
    const st = S.objects[id] || t.def.state;
    $('tName').textContent = cap(t.def.name);
    $('tDesc').textContent = t.def.desc;
    $('tState').textContent = cap(st);
    $('tUsesL').textContent = 'He has used it'; $('tActsL').textContent = 'What he can do here';
    const n = S.uses[id] || 0; $('tUses').textContent = n ? n + (n === 1 ? ' time' : ' times') : 'Not yet';
    const acts = $('tActs'); acts.textContent = '';
    (t.def.actions || []).forEach(a => acts.append(li(cap(a.verb), a.from && a.from !== st ? 'when ' + a.from : (a.to && a.to !== st ? 'makes it ' + a.to : ''))));
    ((world && world.secrets) || []).filter(x => x.object === id && S.secrets[x.id]).forEach(x => acts.append(li(cap(x.verb), S.secrets[x.id] === 'found' ? 'secret he found' : 'secret he noticed')));
    if (openPanel !== 'thing') show('thing', true);
  }
  // A project card: the idea, the plan, the tokens Frederik approved, and what he made last.
  function showProject(p) {
    openThing = null;
    $('tName').textContent = cap(p.title);
    $('tDesc').textContent = p.idea + (p.friend ? ' Friend: ' + p.friend.name + ', ' + p.friend.looks + ', ' + p.friend.colour + '. ' + cap(p.friend.personality) + '. Likes ' + p.friend.likes + '.' : '') + (p.latest ? ' Latest: ' + p.latest : '');
    $('tState').textContent = cap(p.status);
    const t = p.tokens || {};
    $('tUsesL').textContent = 'Tokens used'; $('tActsL').textContent = 'The plan';
    $('tUses').textContent = (t.used || 0).toLocaleString() + ' of ' + (t.approved || 0).toLocaleString() + ' approved' + (p.dkk && p.dkk.spent ? ' (' + p.dkk.spent.toFixed(2).replace('.', ',') + ' kr)' : '');
    const acts = $('tActs'); acts.textContent = '';
    (p.steps || []).forEach((x, i) => acts.append(li((i + 1) + '. ' + x, i < p.done ? 'done' : '')));
    if (openPanel !== 'thing') show('thing', true);
  }
  function focusOn(id) {
    const t = things[id]; if (!t) return;
    focusPoint = new THREE.Vector3(t.group.position.x, 0.6, t.group.position.z); userMovedAt = performance.now();
    showThing(id);
  }
  const ray = new THREE.Raycaster(); const ptr = new THREE.Vector2(); let downAt = null;
  renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 8) return;
    ptr.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(scene.children, true).find(h => h.object.userData.objId || h.object.userData.isGuy);
    if (!hit) { if (openPanel === 'thing') show('thing'); openThing = null; return; }
    if (hit.object.userData.isGuy) { focusPoint = null; userMovedAt = 0; show('stats', true); return; }
    showThing(hit.object.userData.objId);
  });

  // ---------- Day and night, by the viewer's clock ----------
  function setSky() {
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    const day = h >= 7 && h < 18, dusk = (h >= 18 && h < 21) || (h >= 5 && h < 7);
    const sky = day ? 0xbfe3f5 : dusk ? 0xf0b48a : 0x1c2142;
    scene.background.set(sky); scene.fog.color.set(sky);
    hemi.intensity = day ? 0.62 : dusk ? 0.52 : 0.34; sun.intensity = day ? 0.6 : dusk ? 0.45 : 0.18;
    sun.color.set(day ? 0xffffff : dusk ? 0xffd0a0 : 0x9fb0ff);
    const w = things.window && things.window.group.userData.sky; if (w) w.material.color.set(day ? 0x9fd3ff : dusk ? 0xf0a679 : 0x1f2547);
  }

  // ---------- Animation loop ----------
  function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
  addEventListener('resize', resize); resize();
  let last = performance.now(), t = 0, faceTimer = 0, roll = 0, blinkTimer = 2, wanderTimer = 4, idleOffset = [0, 0], fidgetTimer = 6, moodSymTimer = 8;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    const m = moods(); const k = reduce ? 0.03 : 0.06;
    const tc = m.lonely * (1 - m.feisty * 0.6), tk = m.feisty * (1 - m.sleepy * 0.5), td = m.sleepy * (1 - tc) * (1 - tk);
    const ts = Math.max(0, 1 - tc - tk), sum = tc + tk + ts || 1;
    W.c = lerp(W.c, tc / sum, k); W.k = lerp(W.k, tk / sum, k); W.s = lerp(W.s, ts / sum, k); W.d = lerp(W.d, td, k);
    deform();
    if (!reduce) Object.values(secretBits).forEach((b, i) => { if (b.glint.visible) { b.glint.rotation.y += dt * 2; b.glint.position.y = b.base + Math.sin(t * 2.5 + i) * 0.06; } });
    const moodKey = S.sleeping ? 'sleepy' : (palette[S.mood] ? S.mood : 'content');
    const sig = signatureColour();
    // With his own colour he stays recognisably him; moods only tint it. Without one, moods colour him.
    if (sig) { tmpColour.copy(sig).lerp(palette[moodKey], TINT[moodKey] || 0); if (moodKey === 'proud') tmpColour.offsetHSL(0, 0.06, 0.07); } // proud: a little brighter, same him
    bodyMat.color.lerp(sig ? tmpColour : palette[moodKey], 0.03);
    const proud = S.mood === 'proud' && !S.sleeping ? 1 : 0;
    // reactions and symbols are timed with performance.now(), which can run a little ahead of the frame time
    const pnow = performance.now();
    const rp = R.kind && pnow < R.until ? clamp((pnow - R.t0) / (R.until - R.t0)) : -1;
    if (rp < 0) R.kind = '';
    // reactions that move his whole body
    let tilt = 0, extraTurn = 0, reactHop = 0;
    if (rp >= 0 && !reduce) {
      if (R.kind === 'oops') { tilt = Math.sin(Math.min(1, rp * 1.3) * Math.PI) * 1.35; reactHop = rp > 0.75 ? Math.sin((rp - 0.75) * 4 * Math.PI) * 0.12 : 0; }
      else if (R.kind === 'wiggle') { tilt = Math.sin(t * 18) * 0.28 * (1 - rp); reactHop = Math.abs(Math.sin(t * 11)) * 0.2 * (1 - rp); }
      else if (R.kind === 'doubletake') { extraTurn = rp < 0.25 ? -0.5 : rp < 0.35 ? 0.35 : 0.15 * (1 - rp); reactHop = rp > 0.3 && rp < 0.6 ? Math.sin((rp - 0.3) / 0.3 * Math.PI) * 0.45 : 0; }
      else if (R.kind === 'look') extraTurn = Math.sin(rp * Math.PI * 2) * 0.7;
      else if (R.kind === 'hum') tilt = Math.sin(t * 5) * 0.08;
    }

    // follow the route; potter about a little when standing still
    let moving = false, dirx = 0;
    if (route.length) {
      const [tx, tz] = route[0]; const dx = tx - gx, dz = tz - gz, dist = Math.hypot(dx, dz);
      const speed = (W.c < 0.3 ? 1.8 : 0.8);
      if (now < windUpUntil) { /* winding up: crouch first, then go */ }
      else if (dist < 0.05) route.shift();
      else { const step = Math.min(dist, speed * dt); gx += dx / dist * step; gz += dz / dist * step; moving = true; dirx = dx; facing = Math.atan2(dx, dz); if (W.c < 0.3) roll -= step / 0.42; }
    } else if (!S.sleeping && now > actUntil && m.lonely < 0.5) {
      wanderTimer -= dt;
      if (wanderTimer < 0) { wanderTimer = 3 + Math.random() * 5; idleOffset = [(Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.4]; }
      // now and then a little fidget: look around, tap a foot, scratch his head, hum, yawn
      fidgetTimer -= dt;
      if (fidgetTimer < 0 && !R.kind && !reduce) {
        fidgetTimer = 7 + Math.random() * 7;
        const pick = FIDGETS.filter(f => f !== 'yawn' || S.needs.energy < 0.5)[Math.floor(Math.random() * (S.needs.energy < 0.5 ? 5 : 4))];
        react(pick, pick === 'look' ? 2200 : 1700);
        if (pick === 'hum') { showSymbol('\u266a', 1800); chirp('hum'); } else if (pick === 'yawn') chirp('yawn');
      }
    }
    // his mood shows as a symbol now and then, so you can read him from across the screen
    moodSymTimer -= dt;
    if (moodSymTimer < 0) {
      moodSymTimer = 9 + Math.random() * 6;
      if (pnow > SYM.until && !S.sleeping) {
        if (proud) showSymbol('star', 2400); else if (m.lonely > 0.5) showSymbol('cloud', 2600); else if (m.curious > 0.5) showSymbol('?', 2200);
      }
    }
    sym.visible = pnow < SYM.until && !S.sleeping;
    if (sym.visible) {
      const age = Math.max(0, pnow - SYM.shownAt) / 1000, left = (SYM.until - pnow) / 1000;
      sym.scale.setScalar(reduce ? 1 : Math.min(1, age * 5) * Math.min(1, left * 4 + 0.2));
      sym.position.y = 2.35 + (reduce ? 0 : Math.sin(t * 2.2) * 0.06);
      sym.quaternion.copy(camera.quaternion);
    }
    if (!moving && !reduce) { const sp = spotOf(S.place) || [gx, gz]; const tx = sp[0] + (S.sleeping ? 0 : idleOffset[0]), tz = sp[1] + (S.sleeping ? 0 : idleOffset[1]); gx = lerp(gx, tx, 0.01); gz = lerp(gz, tz, 0.01); }
    if (!moving) { const q = Math.PI / 2; roll = lerp(roll, Math.round(roll / q) * q, 0.06); }
    body.rotation.x = roll;

    // doing something with a thing: face it, hop and wave
    if (!moving && actPending) { actUntil = now + actPending; actPending = 0; }
    const acting = now < actUntil && !moving;
    let faceTo = moving ? facing : 0;
    if (acting && things[actTarget]) { const p = things[actTarget].group.position; faceTo = Math.atan2(p.x - gx, p.z - gz) * 0.6; }
    holder.rotation.y = lerp(holder.rotation.y, faceTo + extraTurn, R.kind === 'doubletake' ? 0.3 : 0.08);
    if (acting && actTarget === 'ball' && things.ball) { const b = things.ball.group.userData.ball; b.rotation.x += dt * 4; }
    const tgtThing = things[actTarget];
    if (acting && tgtThing && tgtThing.group.userData.act) tgtThing.group.userData.act(t, actVerb, dt);
    if (!acting && !actPending && tgtThing && tgtThing.group.userData.rest) { tgtThing.group.userData.rest(); actTarget = null; }
    // lying in bed: asleep, napping or snuggled under the blanket, tucked in up to his chin
    const lying = !!things.bed && (S.sleeping || (acting && LIE.test(actVerb)));
    const cover = coverFor();
    if (cover) cover.visible = lying;
    if (things.blanket) things.blanket.group.visible = !lying;

    const radius = W.s + W.c * 0.84 + W.k;
    const bouncy = acting || m.curious > 0.3 || proud;
    const hopAmp = acting ? (actTarget === 'computer' ? 0.03 : 0.25) : proud ? 0.14 : 0.08;
    const hopRaw = (!moving && !reduce && !S.sleeping && !(acting && LIE.test(actVerb)) && bouncy) ? Math.abs(Math.sin(t * (acting ? 8 : proud ? 7 : 5))) : -1;
    let hop = hopRaw >= 0 ? hopRaw * hopAmp : 0;
    hop += reactHop;
    // squash and stretch: squashed when landing or winding up, stretched in the air
    const windingUp = route.length && now < windUpUntil;
    let sy = 1;
    if (windingUp) sy = 0.84;
    else if (hopRaw >= 0) sy = 1 + 0.2 * (hopRaw - 0.35) * (hopAmp / 0.12);
    else if (R.kind === 'doubletake' && rp > 0.25 && rp < 0.32) sy = 0.85;
    sy = Math.max(0.8, Math.min(1.2, sy));
    const sxz = 1 / Math.sqrt(sy);
    guy.scale.set(lerp(guy.scale.x, sxz, 0.35), lerp(guy.scale.y, sy, 0.35), lerp(guy.scale.z, sxz, 0.35));
    const shiver = m.feisty > 0.4 && !reduce ? Math.sin(t * 40) * 0.015 * m.feisty : 0;
    const legH = 0.3 * (moving && W.c < 0.3 ? 0.15 : 1);
    guy.position.y = lerp(guy.position.y, lying ? radius * 0.92 + Math.sin(t * 1.2) * 0.04 : radius * (1 - W.d * 0.12) + legH + hop, 0.15);
    guy.position.x = shiver;
    guy.rotation.x = lerp(guy.rotation.x, lying ? -0.8 : 0, 0.08);
    guy.rotation.z = lerp(guy.rotation.z, lying ? 0.35 : tilt, R.kind === 'wiggle' ? 0.4 : 0.12);
    if (lying) {
      const bp = things.bed.group.position;
      gx = lerp(gx, bp.x - 0.3, 0.1); gz = lerp(gz, bp.z, 0.1); route = [];
      holder.rotation.y = lerp(holder.rotation.y, 0, 0.1);
    }
    holder.position.set(gx, lerp(holder.position.y, lying ? 0.12 : 0, 0.1), gz);
    hat.visible = !lying && S.objects.cap === 'on his head' && (S.items || []).includes('a bottle cap');
    hat.position.y = radius * 0.92;
    shadow.scale.setScalar(radius * (1 - hop));
    legL.position.set(-0.32 * radius, -radius * (1 - W.d * 0.12) + 0.05, 0); legR.position.set(0.32 * radius, legL.position.y, 0);
    legL.scale.y = legR.scale.y = lerp(legL.scale.y, lying ? 0.01 : moving && W.c < 0.3 ? 0.15 : 1, 0.15);
    legR.rotation.x = lerp(legR.rotation.x, R.kind === 'tap' && !reduce ? -Math.abs(Math.sin(t * 14)) * 0.6 : 0, 0.3);
    const armTuck = lying ? 0.01 : moving && W.c < 0.3 ? 0.2 : (m.lonely > 0.5 ? 0.6 : 1);
    [armL, armR].forEach(a => {
      const s = a.userData.side; a.position.set(s * radius * 0.96, 0.05, 0);
      let ang = 0.35;
      if (m.curious > 0.3 && !moving) ang = 0.6 + (s > 0 ? Math.sin(t * 6) * 0.5 + 1.2 : 0);
      if (m.feisty > 0.4) ang = 2.3 + Math.sin(t * 14 + s) * 0.25;
      if (m.lonely > 0.5) ang = 0.1;
      if (m.sleepy > 0.5) ang = 0.05;
      if (acting && actTarget === 'computer') ang = /internet/.test(actVerb) ? (s > 0 ? 1.4 : 0.4) : 1.1 + Math.abs(Math.sin(t * 16 + s * 1.7)) * 0.3;
      else if (acting) ang = /punch/.test(actVerb) ? 1.5 + Math.abs(Math.sin(t * 10 + s * 1.6)) * 0.4 : 2.4 + Math.sin(t * 10 + s * 1.5) * 0.4;
      if (R.kind === 'scratch' && s > 0) ang = 2.7 + Math.sin(t * 16) * 0.2;
      if (R.kind === 'wiggle' || (R.kind === 'doubletake' && rp > 0.3)) ang = 2.5 + Math.sin(t * 12 + s) * 0.3;
      if (R.kind === 'oops') ang = 1.6 + Math.sin(t * 9 + s) * 0.6;
      if (R.kind === 'yawn') ang = 2.2;
      a.rotation.z = lerp(a.rotation.z, s * ang, 0.12);
      a.scale.setScalar(lerp(a.scale.x, armTuck, 0.1));
    });
    shadow.visible = !lying;
    zzz.visible = S.sleeping; if (S.sleeping) { zzz.position.y = 2.4 + Math.sin(t) * 0.15; zzz.quaternion.copy(camera.quaternion); }

    face.position.set(0, 0.06 - W.d * 0.1, radius * (1 + W.d * 0.1) + 0.04);
    blinkTimer -= dt; if (blinkTimer < 0) { F.blink = 1; blinkTimer = 2 + Math.random() * 3; }
    F.blink = Math.max(0, F.blink - dt * 8);
    const react1 = k => (R.kind === k ? 1 : 0);
    const yawn = react1('yawn') * Math.sin(Math.max(0, rp) * Math.PI);
    const wow = react1('doubletake') * (rp > 0.25 && rp < 0.85 ? 1 : 0);
    const tgt = { open: (1 - m.sleepy * 0.9) * (1 - yawn * 0.8), size: 1 + m.curious * 0.2 - m.lonely * 0.1 + (acting ? 0.12 : 0), brow: m.lonely * 0.6 - m.feisty,
      curve: 0.6 - m.lonely * 1.0 - m.feisty * 0.9 + m.curious * 0.3 - m.sleepy * 0.3 + (acting ? 0.4 : 0) + proud * 0.3, mouthOpen: m.curious * 0.6 + (S.sleeping ? 0.2 : 0) + (acting ? 0.4 : 0) + yawn,
      look: R.kind === 'doubletake' ? (rp < 0.25 ? -1 : 0.2) : R.kind === 'look' ? Math.sin(rp * Math.PI * 2) * 1.1 : moving ? Math.sign(dirx) * 0.5 : acting ? 0 : Math.sin(t * 0.4) * 0.4,
      lookY: R.kind === 'scratch' ? 0.8 : acting ? -0.3 : 0,
      grin: (proud || react1('wiggle')) && !acting ? 1 : 0, blush: Math.max(proud, react1('wiggle'), acting ? 0.4 : 0),
      wow, wobble: react1('sad') || (m.lonely > 0.7 ? 1 : 0), dizzy: react1('oops') * (rp < 0.85 ? 1 : 0) };
    for (const key in tgt) F[key] = lerp(F[key], tgt[key], 0.08);
    faceTimer -= dt; if (faceTimer <= 0) { faceTimer = 1 / 30; drawFace(); }

    // little life in built things
    Object.values(things).forEach(th => {
      if (th.popIn !== undefined) { th.popIn = Math.min(1, th.popIn + dt * 1.5); th.group.scale.setScalar(0.01 + 0.99 * (1 - Math.pow(1 - th.popIn, 3))); if (th.popIn >= 1) delete th.popIn; }
      const u = th.group.userData;
      if (u.blink) u.blink.material.color.setHSL((t * 0.2) % 1, 0.6, 0.7);
      if (u.blinkScreen) u.blinkScreen(t);
      if (u.water) u.water.material.color.setHSL(0.56, 0.5, 0.58 + Math.sin(t * 1.5) * 0.03);
    });

    // camera: follows him gently unless someone just dragged it, or eases to a tapped thing
    const idle = now - userMovedAt > 6000;
    const want = focusPoint && !idle ? focusPoint : new THREE.Vector3(gx, 0.6, gz);
    if (idle) focusPoint = null;
    const delta = want.clone().sub(controls.target).multiplyScalar(idle || focusPoint ? 0.04 : 0.0);
    controls.target.add(delta); camera.position.add(delta);
    controls.update();

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  // ---------- Start ----------
  async function poll() {
    try { const r = await fetch('/state', { cache: 'no-store' }); if (r.ok) apply(await r.json()); else updateLive(); }
    catch (e) { updateLive(); }
  }
  async function start() {
    try { const r = await fetch('/world.json'); world = await r.json(); }
    catch (e) { world = { objects: [], plots: [], buildables: [], custom: { desc: '', actions: [] } }; }
    world.objects.forEach(o => { addThing(o, o.pos[0], o.pos[1], SPOT[o.id] || [o.pos[0], o.pos[1] + 1]); });
    // the door and doorstep live in the wall; turn them to face along it
    if (things.doorstep) things.doorstep.group.position.set(HOUSE.x1, 0, 0.6);
    if (things.window) things.window.group.position.set(1.6, 0, HOUSE.z0 + 0.12);
    if (things.shelf) things.shelf.group.position.set(-1.0, 0, HOUSE.z0 + 0.4);
    if (things.lamp) things.lamp.group.position.set(3.4, 0, -2.3);
    buildPlots();
    setSky(); setInterval(setSky, 60000);
    snapCamera();
    await poll();
    renderLists();
    setInterval(poll, 20000); setInterval(updateLive, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
    requestAnimationFrame(frame);
  }
  window.lilguyAct = (object, verb) => startAct(object, verb, '');
  start();
})();

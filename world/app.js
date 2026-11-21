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
    sleeping: false, place: 'rug', mood: 'content', objects: {}, built: [], uses: {}, items: [], wishes: [], projects: []
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
    ball(g) {
      const b = mesh(sph(0.42, 24, 16), toon(0xe0a548), 0, 0.42, 0, g);
      mesh(new THREE.TorusGeometry(0.42, 0.05, 8, 32), toon(0xc2473d), 0, 0.42, 0, g).rotation.y = 0.6;
      g.userData.ball = b; return () => {};
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

  // Where he stands to use each thing.
  const SPOT = { bed: [-2.0, -0.6], shelf: [-1.0, -1.3], rug: [0, 0.4], window: [1.6, -1.4], lamp: [2.4, -1.3], ball: [-0.8, 1.6], doorstep: [3.7, 0.6], field: [9, 0.6], stone: [6.5, 2.4] };
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
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.25), new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, depthWrite: false }));
  guy.add(face);
  const limbMat = toon(0x2a2433);
  function arm(side) {
    const g = new THREE.Group();
    mesh(cyl(0.045, 0.045, 0.5, 10), limbMat, 0, -0.25, 0, g);
    mesh(sph(0.1, 16, 16), limbMat, 0, -0.52, 0, g);
    g.userData.side = side; guy.add(g); return g;
  }
  const armL = arm(-1), armR = arm(1);
  function leg() {
    const g = new THREE.Group();
    mesh(cyl(0.05, 0.05, 0.32, 10), limbMat, 0, -0.16, 0, g);
    const foot = mesh(sph(0.11, 16, 12), limbMat, 0, -0.33, 0.05, g); foot.scale.set(1.3, 0.6, 1.6);
    guy.add(g); return g;
  }
  const legL = leg(), legR = leg();
  const zzz = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshBasicMaterial({ map: labelTexture('Zzz', 'rgba(0,0,0,0)', '#6a4fd8'), transparent: true, depthWrite: false }));
  zzz.position.set(0.9, 2.2, 0); holder.add(zzz);

  function moods() {
    const n = S.needs;
    const sleepy = S.sleeping ? 1 : clamp((0.3 - n.energy) / 0.3);
    return { lonely: clamp((0.4 - n.company) / 0.4), feisty: clamp((n.feisty - 0.45) / 0.55), sleepy, curious: clamp((n.curiosity - 0.5) / 0.5) * (1 - sleepy) };
  }
  const palette = { content: new THREE.Color(0xffc857), curious: new THREE.Color(0xffb347), lonely: new THREE.Color(0x8fa7d6), feisty: new THREE.Color(0xff7a6b), sleepy: new THREE.Color(0xb9a8e0) };
  const W = { s: 1, c: 0, k: 0, d: 0 };
  const F = { open: 1, size: 1, brow: 0, curve: 0.5, mouthOpen: 0.1, look: 0, blink: 0 };
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
      a[i] = x * r * (1 + W.d * 0.12); a[i + 1] = y * r * sag; a[i + 2] = z * r * (1 + W.d * 0.08);
    }
    pos.needsUpdate = true; geo.computeVertexNormals();
  }
  function drawFace() {
    fx.clearRect(0, 0, 512, 512);
    const ink = '#2a2433', eyeY = 220, gap = 92, lx = 256 - gap + F.look * 18, rx = 256 + gap + F.look * 18;
    const open = clamp(F.open * (1 - F.blink));
    for (const ex of [lx, rx]) {
      fx.fillStyle = ink; fx.beginPath(); fx.ellipse(ex, eyeY, 30 * F.size, Math.max(4, 44 * F.size * open), 0, 0, Math.PI * 2); fx.fill();
      if (open > 0.35) { fx.fillStyle = '#fff'; fx.beginPath(); fx.arc(ex + 10, eyeY - 14 * F.size, 9 * F.size, 0, Math.PI * 2); fx.fill(); }
    }
    if (Math.abs(F.brow) > 0.05) {
      fx.strokeStyle = ink; fx.lineWidth = 14; fx.lineCap = 'round';
      for (const [ex, dir] of [[lx, 1], [rx, -1]]) { fx.beginPath(); fx.moveTo(ex - 34, eyeY - 66 + F.brow * 18 * dir); fx.lineTo(ex + 34, eyeY - 66 - F.brow * 18 * dir); fx.stroke(); }
    }
    fx.fillStyle = 'rgba(255,120,120,0.35)';
    for (const ex of [lx - 30, rx + 30]) { fx.beginPath(); fx.ellipse(ex, eyeY + 70, 30, 16, 0, 0, Math.PI * 2); fx.fill(); }
    const my = 330, w = 70, c = F.curve * 46;
    fx.strokeStyle = ink; fx.lineWidth = 13; fx.lineCap = 'round'; fx.fillStyle = ink;
    fx.beginPath(); fx.moveTo(256 - w, my); fx.quadraticCurveTo(256, my + c, 256 + w, my);
    if (F.mouthOpen > 0.15) { fx.quadraticCurveTo(256, my + c + F.mouthOpen * 60, 256 - w, my); fx.fill(); }
    fx.stroke(); faceTex.needsUpdate = true;
  }

  // ---------- Walking ----------
  // He walks along waypoints; going in or out goes through the door.
  const DOOR_IN = [3.6, 0.6], DOOR_OUT = [5.6, 0.6];
  const inside = p => p[0] < HOUSE.x1 && p[0] > HOUSE.x0 && p[1] > HOUSE.z0 && p[1] < HOUSE.z1;
  let gx = 0, gz = 0.4, route = [], facing = 0, actUntil = 0, actTarget = null;
  function walkTo(p) {
    const from = [gx, gz];
    route = [];
    if (inside(from) && !inside(p)) route.push(DOOR_IN, DOOR_OUT);
    else if (!inside(from) && inside(p)) route.push(DOOR_OUT, DOOR_IN);
    route.push(p);
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
    if (world) syncBuilt();
    Object.values(things).forEach(t => t.update(S.objects[t.def.id] || t.def.state));

    const place = S.sleeping ? 'bed' : d.place;
    const spot = spotOf(place) || SPOT.rug;
    if (first) { gx = spot[0]; gz = spot[1]; route = []; snapCamera(); }
    else if (place !== S.place) walkTo(spot);
    S.place = place;

    if (d.last && d.last.at !== lastActAt) {
      if (!first) { actTarget = d.last.object; actUntil = performance.now() + 4000; toast(d.last.line); }
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
  const HL_ICON = { project: '\ud83d\udee0\ufe0f', first: '\u2728', wish: '\ud83c\udf20', yes: '\ud83c\udf89', no: '\u2601\ufe0f', built: '\ud83d\udd28', mood: '\ud83d\udcad', chat: '\ud83d\udcac', gift: '\ud83c\udf81' };
  const HL_BIG = { built: 1, yes: 1, wish: 1, project: 1 };
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
  let last = performance.now(), t = 0, faceTimer = 0, roll = 0, blinkTimer = 2, wanderTimer = 4, idleOffset = [0, 0];
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    const m = moods(); const k = reduce ? 0.03 : 0.06;
    const tc = m.lonely * (1 - m.feisty * 0.6), tk = m.feisty * (1 - m.sleepy * 0.5), td = m.sleepy * (1 - tc) * (1 - tk);
    const ts = Math.max(0, 1 - tc - tk), sum = tc + tk + ts || 1;
    W.c = lerp(W.c, tc / sum, k); W.k = lerp(W.k, tk / sum, k); W.s = lerp(W.s, ts / sum, k); W.d = lerp(W.d, td, k);
    deform();
    bodyMat.color.lerp(palette[S.sleeping ? 'sleepy' : (palette[S.mood] ? S.mood : 'content')], 0.03);

    // follow the route; potter about a little when standing still
    let moving = false, dirx = 0;
    if (route.length) {
      const [tx, tz] = route[0]; const dx = tx - gx, dz = tz - gz, dist = Math.hypot(dx, dz);
      const speed = (W.c < 0.3 ? 1.8 : 0.8);
      if (dist < 0.05) route.shift();
      else { const step = Math.min(dist, speed * dt); gx += dx / dist * step; gz += dz / dist * step; moving = true; dirx = dx; facing = Math.atan2(dx, dz); if (W.c < 0.3) roll -= step / 0.42; }
    } else if (!S.sleeping && now > actUntil && m.lonely < 0.5) {
      wanderTimer -= dt;
      if (wanderTimer < 0) { wanderTimer = 3 + Math.random() * 5; idleOffset = [(Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.4]; }
    }
    if (!moving && !reduce) { const sp = spotOf(S.place) || [gx, gz]; const tx = sp[0] + (S.sleeping ? 0 : idleOffset[0]), tz = sp[1] + (S.sleeping ? 0 : idleOffset[1]); gx = lerp(gx, tx, 0.01); gz = lerp(gz, tz, 0.01); }
    if (!moving) { const q = Math.PI / 2; roll = lerp(roll, Math.round(roll / q) * q, 0.06); }
    body.rotation.x = roll;

    // doing something with a thing: face it, hop and wave
    const acting = now < actUntil && !moving;
    let faceTo = moving ? facing : 0;
    if (acting && things[actTarget]) { const p = things[actTarget].group.position; faceTo = Math.atan2(p.x - gx, p.z - gz) * 0.6; }
    holder.rotation.y = lerp(holder.rotation.y, faceTo, 0.08);
    if (acting && actTarget === 'ball' && things.ball) { const b = things.ball.group.userData.ball; b.rotation.x += dt * 4; }

    const radius = W.s + W.c * 0.84 + W.k;
    const hop = (!moving && !reduce && !S.sleeping && (acting || m.curious > 0.3)) ? Math.abs(Math.sin(t * (acting ? 8 : 5))) * (acting ? 0.25 : 0.08) : 0;
    const shiver = m.feisty > 0.4 && !reduce ? Math.sin(t * 40) * 0.015 * m.feisty : 0;
    const legH = 0.42 * (moving && W.c < 0.3 ? 0.15 : 1);
    const bedLift = S.sleeping && S.place === 'bed' ? 0.55 : 0;
    guy.position.y = lerp(guy.position.y, radius * (1 - W.d * 0.12) + legH + hop + (S.sleeping ? Math.sin(t * 1.2) * 0.03 : 0), 0.15);
    guy.position.x = shiver;
    holder.position.set(gx, bedLift, gz);
    shadow.scale.setScalar(radius * (1 - hop));
    legL.position.set(-0.32 * radius, -radius * (1 - W.d * 0.12) + 0.05, 0); legR.position.set(0.32 * radius, legL.position.y, 0);
    legL.scale.y = legR.scale.y = lerp(legL.scale.y, moving && W.c < 0.3 ? 0.15 : 1, 0.15);
    const armTuck = moving && W.c < 0.3 ? 0.2 : (m.lonely > 0.5 ? 0.6 : 1);
    [armL, armR].forEach(a => {
      const s = a.userData.side; a.position.set(s * radius * 0.96, 0.05, 0);
      let ang = 0.35;
      if (m.curious > 0.3 && !moving) ang = 0.6 + (s > 0 ? Math.sin(t * 6) * 0.5 + 1.2 : 0);
      if (m.feisty > 0.4) ang = 2.3 + Math.sin(t * 14 + s) * 0.25;
      if (m.lonely > 0.5) ang = 0.1;
      if (m.sleepy > 0.5) ang = 0.05;
      if (acting) ang = 2.4 + Math.sin(t * 10 + s * 1.5) * 0.4;
      a.rotation.z = lerp(a.rotation.z, s * ang, 0.12);
      a.scale.setScalar(lerp(a.scale.x, armTuck, 0.1));
    });
    zzz.visible = S.sleeping; if (S.sleeping) { zzz.position.y = 2.4 + Math.sin(t) * 0.15; zzz.quaternion.copy(camera.quaternion); }

    face.position.set(0, 0.06 - W.d * 0.1, radius + 0.03);
    blinkTimer -= dt; if (blinkTimer < 0) { F.blink = 1; blinkTimer = 2 + Math.random() * 3; }
    F.blink = Math.max(0, F.blink - dt * 8);
    const tgt = { open: 1 - m.sleepy * 0.9, size: 1 + m.curious * 0.25 - m.lonely * 0.1 + (acting ? 0.15 : 0), brow: m.lonely * 0.6 - m.feisty,
      curve: 0.6 - m.lonely * 1.0 - m.feisty * 0.9 + m.curious * 0.3 - m.sleepy * 0.3 + (acting ? 0.4 : 0), mouthOpen: m.curious * 0.6 + (S.sleeping ? 0.2 : 0) + (acting ? 0.4 : 0),
      look: moving ? Math.sign(dirx) * 0.5 : Math.sin(t * 0.4) * 0.4 };
    for (const key in tgt) F[key] = lerp(F[key], tgt[key], 0.08);
    faceTimer -= dt; if (faceTimer <= 0) { faceTimer = 1 / 30; drawFace(); }

    // little life in built things
    Object.values(things).forEach(th => {
      if (th.popIn !== undefined) { th.popIn = Math.min(1, th.popIn + dt * 1.5); th.group.scale.setScalar(0.01 + 0.99 * (1 - Math.pow(1 - th.popIn, 3))); if (th.popIn >= 1) delete th.popIn; }
      const u = th.group.userData;
      if (u.blink) u.blink.material.color.setHSL((t * 0.2) % 1, 0.6, 0.7);
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
  start();
})();

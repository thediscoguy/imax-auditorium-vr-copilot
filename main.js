// main.js - prototype core (uses three.js from CDN)
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.154.0/examples/jsm/controls/OrbitControls.js';
import { XRButton } from 'https://cdn.jsdelivr.net/npm/three@0.154.0/examples/jsm/webxr/XRButton.js';

const STORAGE_KEY = 'imax_viewer_user';
const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;

let renderer, scene, camera, controls;
let currentConfig = null;
let xrUserHeight = 1.7; // meters default
let seatInstancedMesh = null;

async function init() {
  setupUI();
  initThree();
  const configs = await loadLocalConfigs(); // loads the two JSONs embedded or from server folder
  populateTheaterSelector(configs);
  const defaultConfig = configs[0];
  await loadTheaterConfig(defaultConfig);
  checkHeightPrompt();
  showEnterXR();
}

function initThree() {
  const container = document.getElementById('canvasContainer');
  renderer = new THREE.WebGLRenderer({ antialias:true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050507);

  camera = new THREE.PerspectiveCamera(70, window.innerWidth/window.innerHeight, 0.1, 1000);
  camera.position.set(0, xrUserHeight, 5);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, xrUserHeight, -10);
  controls.update();

  const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 0.6);
  scene.add(hemi);
  const spot = new THREE.SpotLight(0xffffff, 0.6);
  spot.position.set(0, 20, 10);
  scene.add(spot);

  window.addEventListener('resize', onWindowResize);
  renderer.setAnimationLoop(render);
}

function render() {
  renderer.render(scene, camera);
}

function onWindowResize() {
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ---------- UI and storage ----------
function loadUser() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
}
function saveUser(obj) {
  obj.timestamp_ms = Date.now();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  window.dispatchEvent(new CustomEvent('userHeightChanged', { detail: obj }));
}
function needsReask() {
  const u = loadUser();
  if (!u.timestamp_ms) return true;
  return (Date.now() - u.timestamp_ms) >= SIX_MONTHS_MS;
}

function setupUI() {
  const editBtn = document.getElementById('editHeightBtn');
  editBtn.addEventListener('click', () => openHeightModal());
  document.getElementById('saveHeight').addEventListener('click', onSaveHeightClicked);
  document.getElementById('skipHeight').addEventListener('click', onSkipHeightClicked);
  document.getElementById('enterXR').addEventListener('click', onEnterXR);
  document.getElementById('theaterSelect').addEventListener('change', async (e) => {
    const name = e.target.value;
    const cfg = window._availableConfigs.find(c => c.venueName === name);
    if (cfg) await loadTheaterConfig(cfg);
  });
}

function checkHeightPrompt() {
  const user = loadUser();
  if (!user.height_cm || needsReask()) {
    openHeightModal();
  } else {
    applyUserHeight(user.height_cm);
    document.getElementById('editHeightBtn').classList.remove('hidden');
  }
}

function openHeightModal() {
  document.getElementById('heightModal').classList.remove('hidden');
  const user = loadUser();
  if (user.units === 'cm') {
    document.getElementById('heightUnits').value = 'cm';
    document.getElementById('heightInput').value = user.height_cm || '';
  } else {
    document.getElementById('heightUnits').value = 'ft';
    if (user.height_cm) {
      const inches = Math.round(user.height_cm / 2.54);
      const ft = Math.floor(inches / 12);
      const rem = inches % 12;
      document.getElementById('heightInput').value = `${ft}'${rem}"`;
    } else {
      document.getElementById('heightInput').value = '';
    }
  }
}

function closeHeightModal() {
  document.getElementById('heightModal').classList.add('hidden');
  document.getElementById('editHeightBtn').classList.remove('hidden');
}

function parseHeightInput(raw, units) {
  if (units === 'cm') {
    const v = parseFloat(raw);
    if (isNaN(v)) return null;
    return v;
  } else {
    // accept formats like 5'10", 5'10, 5.83, 70in
    raw = raw.trim();
    if (/^\d+(\.\d+)?$/.test(raw)) {
      // plain number assume inches if > 50, else feet.decimal
      const n = parseFloat(raw);
      if (n > 50) return n * 2.54;
      return n * 30.48;
    }
    const ftIn = raw.match(/(\d+)\s*'\s*(\d+)\s*"?/);
    if (ftIn) {
      const ft = parseInt(ftIn[1],10);
      const inch = parseInt(ftIn[2],10);
      return (ft*12 + inch) * 2.54;
    }
    const onlyIn = raw.match(/(\d+)\s*in/);
    if (onlyIn) return parseInt(onlyIn[1],10) * 2.54;
    return null;
  }
}

function onSaveHeightClicked() {
  const units = document.getElementById('heightUnits').value;
  const raw = document.getElementById('heightInput').value;
  const cm = parseHeightInput(raw, units);
  if (!cm) {
    alert('Please enter a valid height');
    return;
  }
  saveUser({ height_cm: cm, units });
  applyUserHeight(cm);
  closeHeightModal();
}

function onSkipHeightClicked() {
  saveUser({ skipped: true, units: 'ft' });
  closeHeightModal();
}

function applyUserHeight(height_cm) {
  xrUserHeight = height_cm / 100;
  camera.position.y = xrUserHeight;
  controls.target.y = xrUserHeight;
  controls.update();
}

// ---------- Config loading ----------
async function loadLocalConfigs() {
  // In a deployed app, fetch JSON files from a folder. For prototype, embed the two JSONs inline.
  const configs = [
    // Regal New Roc
    {
      venueName: "Regal New Roc IMAX",
      address: "33 LeCount Place, New Rochelle, NY, 10801",
      coordinates: { lat: 40.91131, lon: -73.78054 },
      units: "feet",
      screen: { width_ft:81.5, height_ft:59.5, width_m:24.8, height_m:18.1, type:"1.43:1", curvature_radius_ft:180, color:"#ffffff", position:{x:0,y:9,z:-40} },
      projector: { type:"15/70 + Commercial Laser", digital:"Commercial Laser", film:"GT" },
      lastKnown70mm: "Interstellar",
      seatDimensions: { seatWidth_ft:0.55, seatPitch_ft:0.9, rowRake_ft:0.4 },
      seatLayout: [
        { rowId:"A", count:16, offset_ft:-7.5, elevation_ft:0 },
        { rowId:"B", count:18, offset_ft:-8.5, elevation_ft:0.4 },
        { rowId:"C", count:20, offset_ft:-9.5, elevation_ft:0.8 },
        { rowId:"D", count:22, offset_ft:-10.5, elevation_ft:1.2 },
        { rowId:"E", count:24, offset_ft:-11.5, elevation_ft:1.6 }
      ],
      scoringWeights: { angle:0.55, distance:0.25, centerOffset:0.20 },
      sourceUrl: "https://www.imax.com/theatre/regal-new-roc-imax"
    },
    // AMC Lincoln Square
    {
      venueName: "AMC Lincoln Square 13 IMAX",
      address: "1998 Broadway, New York, NY, 10023",
      coordinates: { lat: 40.7752, lon: -73.9818 },
      units: "feet",
      screen: { width_ft:101, height_ft:75.6, width_m:30.8, height_m:23, type:"1.43:1", curvature_radius_ft:200, color:"#ffffff", position:{x:0,y:11,z:-55} },
      projector: { type:"15/70 + GT Laser", digital:"GT Laser", film:"GT3D" },
      lastKnown70mm: "Project Hail Mary",
      seatDimensions: { seatWidth_ft:0.55, seatPitch_ft:0.95, rowRake_ft:0.45 },
      seatLayout: [
        { rowId:"A", count:18, offset_ft:-8.5, elevation_ft:0 },
        { rowId:"B", count:20, offset_ft:-9.5, elevation_ft:0.45 },
        { rowId:"C", count:22, offset_ft:-10.5, elevation_ft:0.9 },
        { rowId:"D", count:24, offset_ft:-11.5, elevation_ft:1.35 },
        { rowId:"E", count:26, offset_ft:-12.5, elevation_ft:1.8 },
        { rowId:"F", count:28, offset_ft:-13.5, elevation_ft:2.25 }
      ],
      scoringWeights: { angle:0.5, distance:0.3, centerOffset:0.2 },
      sourceUrl: "https://www.imax.com/theatre/amc-lincoln-square-13-imax"
    }
  ];

  // store globally for selector lookup
  window._availableConfigs = configs.sort((a,b) => a.venueName.localeCompare(b.venueName));
  return window._availableConfigs;
}

function populateTheaterSelector(configs) {
  const sel = document.getElementById('theaterSelect');
  const label = document.getElementById('theaterLabel');
  if (configs.length <= 1) {
    sel.classList.add('hidden');
    label.textContent = configs[0].venueName;
  } else {
    sel.classList.remove('hidden');
    sel.innerHTML = '';
    configs.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.venueName;
      opt.textContent = c.venueName;
      sel.appendChild(opt);
    });
    label.textContent = 'Select theater';
  }
}

// ---------- Theater load and scene build ----------
async function loadTheaterConfig(cfg) {
  currentConfig = cfg;
  document.getElementById('metaPanel').classList.remove('hidden');
  document.getElementById('metaPanel').innerHTML = `<strong>${cfg.venueName}</strong><div>${cfg.address}</div><div>Screen: ${cfg.screen.width_ft} ft × ${cfg.screen.height_ft} ft</div>`;
  rebuildSceneFromConfig(cfg);
}

function rebuildSceneFromConfig(cfg) {
  // clear previous theater objects except lights
  for (let i = scene.children.length - 1; i >= 0; i--) {
    const obj = scene.children[i];
    if (obj.userData && obj.userData.keep) continue;
    if (obj.type === 'HemisphereLight' || obj.type === 'SpotLight') continue;
    scene.remove(obj);
  }

  // add floor and walls to match dark IMAX reference
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200,200), new THREE.MeshStandardMaterial({ color:0x080808 }));
  floor.rotation.x = -Math.PI/2;
  floor.position.y = -0.1;
  scene.add(floor);

  // create curved screen
  const screen = createCurvedScreen(cfg.screen);
  screen.userData.keep = true;
  scene.add(screen);

  // generate seats
  if (seatInstancedMesh) {
    scene.remove(seatInstancedMesh);
    seatInstancedMesh = null;
  }
  seatInstancedMesh = generateSeats(cfg);
  scene.add(seatInstancedMesh);

  // position camera a bit back from center
  camera.position.set(0, xrUserHeight, 5);
  controls.target.set(0, xrUserHeight, -10);
  controls.update();
}

function createCurvedScreen(screenCfg) {
  // convert units to meters if needed
  const width_m = screenCfg.width_m || (screenCfg.width_ft * 0.3048);
  const height_m = screenCfg.height_m || (screenCfg.height_ft * 0.3048);
  const radius_m = (screenCfg.curvature_radius_ft || 0) * 0.3048;

  // if curvature radius is zero or very large, make flat plane
  if (!radius_m || radius_m > 1000) {
    const geom = new THREE.PlaneGeometry(width_m, height_m, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: screenCfg.color || '#ffffff', side: THREE.DoubleSide, roughness: 0.6 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(screenCfg.position.x || 0, screenCfg.position.y || height_m/2, screenCfg.position.z || -10);
    return mesh;
  }

  // create curved screen as a segment of a cylinder
  const halfWidth = width_m / 2;
  const theta = halfWidth / radius_m; // half-angle
  const segments = Math.max(8, Math.round(width_m * 10));
  const geometry = new THREE.BufferGeometry();
  const verts = [];
  const uvs = [];
  for (let i = -segments; i <= segments; i++) {
    const t = i / segments;
    const angle = t * theta;
    const x = Math.sin(angle) * radius_m;
    const z = -Math.cos(angle) * radius_m + radius_m;
    const u = (t + 1) / 2;
    // top and bottom vertices
    verts.push(x, height_m/2, z);
    uvs.push(u, 1);
    verts.push(x, -height_m/2, z);
    uvs.push(u, 0);
  }
  const positions = new Float32Array(verts);
  const uvArr = new Float32Array(uvs);

  // build index
  const indices = [];
  const cols = (segments*2 + 1);
  for (let i = 0; i < cols - 1; i++) {
    const a = i*2, b = a+1, c = a+2, d = a+3;
    indices.push(a, c, b);
    indices.push(c, d, b);
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ color: screenCfg.color || '#ffffff', side: THREE.DoubleSide, roughness: 0.6 });
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(screenCfg.position.x || 0, screenCfg.position.y || height_m/2, screenCfg.position.z || -10);
  mesh.rotation.y = 0;
  return mesh;
}

function generateSeats(cfg) {
  // convert dims to meters
  const seatW = (cfg.seatDimensions.seatWidth_ft || 0.55) * 0.3048;
  const pitch = (cfg.seatDimensions.seatPitch_ft || 0.9) * 0.3048;
  const rows = cfg.seatLayout;
  // simple seat geometry
  const seatGeom = new THREE.BoxGeometry(seatW*0.9, 0.8, seatW*0.9);
  const seatMat = new THREE.MeshStandardMaterial({ color:0x111111, roughness:0.9 });
  const totalSeats = rows.reduce((s,r) => s + r.count, 0);
  const inst = new THREE.InstancedMesh(seatGeom, seatMat, totalSeats);
  let idx = 0;
  const screenPos = cfg.screen.position || { x:0, y:0, z:-10 };
  const screenHeight_m = cfg.screen.height_m || (cfg.screen.height_ft * 0.3048);
  const screenTopY = screenPos.y + screenHeight_m/2;

  rows.forEach((row, rIdx) => {
    const rowElev = (row.elevation_ft || 0) * 0.3048;
    const count = row.count;
    const offset = (row.offset_ft || 0) * 0.3048;
    const rowZ = screenPos.z + 2 + (rIdx * pitch); // simple spacing away from screen
    const center = 0;
    for (let s = 0; s < count; s++) {
      const x = offset + (s - (count-1)/2) * seatW * 1.05;
      const y = rowElev + 0.4;
      const m = new THREE.Object3D();
      m.position.set(x, y, rowZ);
      m.updateMatrix();
      inst.setMatrixAt(idx++, m.matrix);
    }
  });

  inst.instanceMatrix.needsUpdate = true;
  return inst;
}

// ---------- WebXR entry ----------
function showEnterXR() {
  const btn = document.getElementById('enterXR');
  btn.classList.remove('hidden');
  // attach three.js XRButton for proper session handling
  const xrBtn = XRButton.createButton(renderer);
  // replace our button with XRButton UI
  btn.replaceWith(xrBtn);
}

// ---------- start ----------
init();

// Background scene: nebula sky, starfield, Lorenz attractor swarm and a supercell tornado.
// The camera flies between them as the page scrolls.
import * as THREE from './three.module.min.js';

const canvas = document.getElementById('stage');

let renderer;
try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (err) {
    dispatchEvent(new Event('scene-failed'));
    throw err;
}

const small = matchMedia('(max-width: 760px)').matches;
const lowPower = small || (navigator.hardwareConcurrency || 8) <= 4;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PR = Math.min(devicePixelRatio || 1, lowPower ? 1.5 : 1.75);
let pixelRatio = PR;
const prUniforms = []; // every material whose point size depends on the pixel ratio

renderer.setPixelRatio(PR);
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x04050a, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 5000);

const rand = Math.random;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------------------------------------------------------------- materials

function glowMaterial(scale = 300) {
    return trackPR(new THREE.ShaderMaterial({
        uniforms: { uPR: { value: pixelRatio }, uScale: { value: scale }, uBoost: { value: 1 }, uOpacity: { value: 1 } },
        vertexShader: /* glsl */`
            attribute float aSize;
            attribute vec3 aColor;
            uniform float uPR, uScale;
            varying vec3 vColor;
            void main() {
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mv;
                gl_PointSize = clamp(aSize * uPR * uScale / max(-mv.z, 0.1), 0.0, 64.0);
                vColor = aColor;
            }`,
        fragmentShader: /* glsl */`
            uniform float uBoost, uOpacity;
            varying vec3 vColor;
            void main() {
                float d = length(gl_PointCoord - 0.5);
                float a = smoothstep(0.5, 0.0, d);
                gl_FragColor = vec4(vColor * uBoost, a * a * uOpacity);
            }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    }));
}

function trackPR(mat) {
    prUniforms.push(mat.uniforms.uPR);
    return mat;
}

function pointCloud(n, scale, mat = glowMaterial(scale)) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return { pts, geo, pos, col, size, mat };
}

// ---------------------------------------------------------------- sky

const bandNormal = new THREE.Vector3(0.25, 1, -0.35).normalize();

// The nebula is costly per pixel, so it is rendered once into an equirectangular
// texture that matches SphereGeometry's UV layout.
const skyBake = new THREE.WebGLRenderTarget(lowPower ? 2048 : 4096, lowPower ? 1024 : 2048);
{
    const bake = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
        uniforms: { uBandN: { value: bandNormal } },
        vertexShader: /* glsl */`
            varying vec2 vUv;
            void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: /* glsl */`
                        uniform vec3 uBandN;
            varying vec2 vUv;
            float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
            float noise(vec3 x) {
                vec3 i = floor(x), f = fract(x);
                f = f * f * (3.0 - 2.0 * f);
                return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                           mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
            }
            float fbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
            void main() {
                float u = vUv.x, v = 1.0 - vUv.y;
                vec3 d = vec3(-cos(6.2831853 * u) * sin(3.1415927 * v), cos(3.1415927 * v), sin(6.2831853 * u) * sin(3.1415927 * v));
                float band = exp(-pow(dot(d, uBandN) * 3.0, 2.0));
                float n = fbm(d * 2.6);
                float n2 = fbm(d * 7.0 + 11.0);
                vec3 col = vec3(0.010, 0.013, 0.028);
                col += vec3(0.045, 0.080, 0.160) * pow(n, 2.2);
                col += vec3(0.210, 0.125, 0.060) * band * pow(n, 1.6) * 1.15;
                col += vec3(0.900, 0.760, 0.560) * band * pow(n2, 4.0) * 0.16;
                col *= 1.0 - smoothstep(0.48, 0.78, n2) * band * 0.65;
                gl_FragColor = vec4(col, 1.0);
            }`,
    }));
    const bakeScene = new THREE.Scene();
    bakeScene.add(bake);
    renderer.setRenderTarget(skyBake);
    renderer.render(bakeScene, new THREE.Camera());
    renderer.setRenderTarget(null);
    bake.geometry.dispose();
    bake.material.dispose();
}

const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2600, 64, 32),
    new THREE.ShaderMaterial({
        uniforms: { tSky: { value: skyBake.texture } },
        vertexShader: /* glsl */`
            varying vec2 vUv;
            void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */`
            uniform sampler2D tSky;
            varying vec2 vUv;
            void main() { gl_FragColor = texture2D(tSky, vUv); }`,
        side: THREE.BackSide,
        depthWrite: false,
    })
);
sky.renderOrder = -2;
scene.add(sky);

// ---------------------------------------------------------------- stars

const starMat = trackPR(new THREE.ShaderMaterial({
    uniforms: { uPR: { value: pixelRatio }, uTime: { value: 0 } },
    vertexShader: /* glsl */`
        attribute float aSize;
        attribute vec3 aColor;
        attribute float aPhase;
        uniform float uPR, uTime;
        varying vec3 vColor;
        void main() {
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            float tw = 0.72 + 0.28 * sin(uTime * (0.6 + aPhase * 2.5) + aPhase * 60.0);
            gl_PointSize = aSize * uPR * (0.85 + 0.15 * tw);
            vColor = aColor * tw;
        }`,
    fragmentShader: /* glsl */`
        varying vec3 vColor;
        void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.05, d);
            gl_FragColor = vec4(vColor, a);
        }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
}));

{
    const n = lowPower ? 3500 : 7000;
    const stars = pointCloud(n, 1, starMat);
    const phase = new Float32Array(n);
    const v = new THREE.Vector3();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), bandNormal);
    for (let i = 0; i < n; i++) {
        v.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
        if (rand() < 0.45) { v.y *= 0.1; v.normalize().applyQuaternion(q); } // galactic band
        v.multiplyScalar(900 + rand() * 1300);
        stars.pos.set([v.x, v.y, v.z], i * 3);
        const t = rand();
        const c = t < 0.3 ? [0.72, 0.82, 1.0] : t < 0.8 ? [1.0, 0.97, 0.92] : [1.0, 0.8, 0.55];
        const b = 0.35 + Math.pow(rand(), 3) * 1.1;
        stars.col.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
        stars.size[i] = 1.0 + Math.pow(rand(), 4) * 3.2;
        phase[i] = rand();
    }
    stars.geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    scene.add(stars.pts);
}

// A warm distant sun behind the attractor, for rim light
{
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,236,200,1)');
    grd.addColorStop(0.12, 'rgba(255,200,130,0.55)');
    grd.addColorStop(0.4, 'rgba(220,140,60,0.12)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55,
    }));
    sun.position.set(-140, 60, -620);
    sun.scale.setScalar(420);
    scene.add(sun);
}

// ---------------------------------------------------------------- Lorenz attractor

const L = { sigma: 10, rho: 28, beta: 8 / 3 };
const lorenz = new THREE.Group();
scene.add(lorenz);

const NL = lowPower ? 6000 : 14000;
const swarm = pointCloud(NL, 300);
const state = new Float64Array(NL * 3);
const tag = new Float32Array(NL);       // seconds left of "perturbed" highlight
const baseSize = new Float32Array(NL);
const TAG_TIME = 20;
lorenz.add(swarm.pts);

let yShift = L.rho - 3; // keeps the attractor centred on the origin

function lorenzStep(s, h) {
    const x = s[0], y = s[1], z = s[2];
    s[0] = x + h * L.sigma * (y - x);
    s[1] = y + h * (x * (L.rho - z) - y);
    s[2] = z + h * (x * y - L.beta * z);
}

// settle onto the attractor before seeding
const seed = [0.1, 0, 0];
for (let i = 0; i < 4000; i++) lorenzStep(seed, 0.005);

// every particle starts within 10^-2 of one point: watch them diverge
for (let i = 0; i < NL; i++) {
    state[i * 3] = seed[0] + (rand() - 0.5) * 0.02;
    state[i * 3 + 1] = seed[1] + (rand() - 0.5) * 0.02;
    state[i * 3 + 2] = seed[2] + (rand() - 0.5) * 0.02;
    swarm.size[i] = baseSize[i] = 0.45 + rand() * 0.9;
}
const swarmGain = 0.2 * Math.min(1.6, 14000 / NL);

// faint skeleton of the attractor
const SKEL = lowPower ? 16000 : 30000;
const skelGeo = new THREE.BufferGeometry();
const skelPos = new Float32Array(SKEL * 3);
const skelCol = new Float32Array(SKEL * 3);
skelGeo.setAttribute('position', new THREE.BufferAttribute(skelPos, 3));
skelGeo.setAttribute('color', new THREE.BufferAttribute(skelCol, 3));
const skeleton = new THREE.Line(skelGeo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
}));
skeleton.frustumCulled = false;
lorenz.add(skeleton);

function buildSkeleton(from) {
    const s = from.slice();
    for (let i = 0; i < 600; i++) lorenzStep(s, 0.005);
    for (let i = 0; i < SKEL; i++) {
        lorenzStep(s, 0.005);
        skelPos[i * 3] = s[0];
        skelPos[i * 3 + 1] = s[2] - yShift;
        skelPos[i * 3 + 2] = s[1];
        const w = 0.05 + 0.03 * Math.sin(i * 0.002);
        skelCol[i * 3] = 0.95 * w; skelCol[i * 3 + 1] = 0.72 * w; skelCol[i * 3 + 2] = 0.42 * w;
    }
    skelGeo.attributes.position.needsUpdate = true;
    skelGeo.attributes.color.needsUpdate = true;
}
buildSkeleton(seed);

// glowing comet trail behind the lead particle
const TRAIL = 520;
const trailGeo = new THREE.BufferGeometry();
const trailPos = new Float32Array(TRAIL * 3);
const trailCol = new Float32Array(TRAIL * 3);
for (let i = 0; i < TRAIL; i++) {
    const f = Math.pow(1 - i / TRAIL, 1.6);
    trailCol.set([0.72 * f, 0.55 * f, 0.32 * f], i * 3);
    trailPos.set([seed[0], seed[2] - yShift, seed[1]], i * 3);
}
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3).setUsage(THREE.DynamicDrawUsage));
trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
}));
trail.frustumCulled = false;
lorenz.add(trail);

const GOLD = [1.0, 0.7, 0.34], WHITE = [0.85, 0.92, 1.0], ICE = [0.35, 0.72, 1.0];

function updateLorenz(dt) {
    const steps = 4, h = dt / steps;
    const { sigma, rho, beta } = L;
    const pos = swarm.pos, col = swarm.col, size = swarm.size;
    let tagged = false;
    for (let i = 0; i < NL; i++) {
        const k = i * 3;
        let x = state[k], y = state[k + 1], z = state[k + 2], dx = 0, dy = 0, dz = 0;
        for (let s = 0; s < steps; s++) {
            dx = sigma * (y - x);
            dy = x * (rho - z) - y;
            dz = x * y - beta * z;
            x += h * dx; y += h * dy; z += h * dz;
        }
        state[k] = x; state[k + 1] = y; state[k + 2] = z;
        pos[k] = x; pos[k + 1] = z - yShift; pos[k + 2] = y;

        const sp = clamp(Math.sqrt(dx * dx + dy * dy + dz * dz) / 170, 0, 1);
        let r = GOLD[0] + (WHITE[0] - GOLD[0]) * sp;
        let g = GOLD[1] + (WHITE[1] - GOLD[1]) * sp;
        let b = GOLD[2] + (WHITE[2] - GOLD[2]) * sp;
        let gain = swarmGain;
        if (tag[i] > 0) {
            tag[i] = Math.max(0, tag[i] - dt);
            const m = Math.min(1, tag[i] / 6);
            r += (ICE[0] - r) * m; g += (ICE[1] - g) * m; b += (ICE[2] - b) * m;
            gain *= 1 + 2.5 * m;
            size[i] = baseSize[i] * (1 + 1.6 * m);
            tagged = true;
        }
        col[k] = r * gain; col[k + 1] = g * gain; col[k + 2] = b * gain;
    }
    swarm.geo.attributes.position.needsUpdate = true;
    swarm.geo.attributes.aColor.needsUpdate = true;
    if (tagged || sizesDirty) { swarm.geo.attributes.aSize.needsUpdate = true; sizesDirty = tagged; }

    trailPos.copyWithin(3, 0, (TRAIL - 1) * 3);
    trailPos[0] = pos[0]; trailPos[1] = pos[1]; trailPos[2] = pos[2];
    trailGeo.attributes.position.needsUpdate = true;
}

// --- butterfly: re-seed a cluster of particles within 1e-4 of one state
let perturbCursor = 1, sizesDirty = false;
const PERTURB_N = lowPower ? 600 : 1200;

function perturb(from) {
    const s = from || [state[3], state[4], state[5]];
    for (let n = 0; n < PERTURB_N; n++) {
        const i = perturbCursor;
        perturbCursor = perturbCursor + 1 >= NL ? 1 : perturbCursor + 1;
        state[i * 3] = s[0] + (rand() - 0.5) * 1e-4;
        state[i * 3 + 1] = s[1] + (rand() - 0.5) * 1e-4;
        state[i * 3 + 2] = s[2] + (rand() - 0.5) * 1e-4;
        tag[i] = TAG_TIME;
    }
}

// pick the particle closest to the click ray
const raycaster = new THREE.Raycaster();
const invM = new THREE.Matrix4();
const tmp = new THREE.Vector3();

function pickState(cx, cy) {
    raycaster.setFromCamera(new THREE.Vector2(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1), camera);
    invM.copy(lorenz.matrixWorld).invert();
    const ray = raycaster.ray.clone().applyMatrix4(invM);
    let best = -1, bestD = 36; // must be within 6 units of a particle
    for (let n = 0; n < 2500; n++) {
        const i = (rand() * NL) | 0;
        tmp.fromArray(swarm.pos, i * 3);
        const d = ray.distanceSqToPoint(tmp);
        if (d < bestD) { bestD = d; best = i; }
    }
    return best < 0 ? null : [state[best * 3], state[best * 3 + 1], state[best * 3 + 2]];
}

addEventListener('click', (e) => {
    if (e.target.closest('.panel, a, button, input, label, .lightbox, .topbar, .rail, h1, h2, p, blockquote, .tag')) return;
    perturb(pickState(e.clientX, e.clientY) || undefined);
});
document.getElementById('perturb').addEventListener('click', () => perturb());

// --- rho control
const rhoInput = document.getElementById('rho');
const rhoOut = document.getElementById('rhoOut');
const regime = document.getElementById('regime');
let skelTimer = 0;
rhoInput.addEventListener('input', () => {
    L.rho = parseFloat(rhoInput.value);
    rhoOut.textContent = L.rho.toFixed(1);
    regime.textContent = L.rho < 24.74 ? 'STEADY CONVECTION' : 'CHAOTIC';
    clearTimeout(skelTimer);
    skelTimer = setTimeout(() => buildSkeleton([state[0] || 0.1, state[1], state[2]]), 120);
});

// ---------------------------------------------------------------- tornado

const T = new THREE.Vector3(170, -42, -110);
const H = 74;
const storm = new THREE.Group();
storm.position.copy(T);
scene.add(storm);

const NF = lowPower ? 5000 : 12000;
const funnel = pointCloud(NF, 300);
const fh = new Float32Array(NF), fth = new Float32Array(NF), fj = new Float32Array(NF), fsp = new Float32Array(NF);
for (let i = 0; i < NF; i++) {
    fh[i] = rand(); fth[i] = rand() * Math.PI * 2; fj[i] = rand(); fsp[i] = rand();
    const b = 0.19 * (0.45 + fj[i]) * (lowPower ? 1.6 : 1);
    const warm = rand() < 0.08;
    funnel.col.set(warm ? [0.9 * b, 0.75 * b, 0.55 * b] : [0.62 * b, 0.72 * b, 0.9 * b], i * 3);
    funnel.size[i] = 1.0 + rand() * 2.2;
}
storm.add(funnel.pts);

const ND = lowPower ? 1200 : 2800;
const debris = pointCloud(ND, 300);
const du = new Float32Array(ND), dth = new Float32Array(ND), dk = new Float32Array(ND);
for (let i = 0; i < ND; i++) {
    du[i] = rand(); dth[i] = rand() * Math.PI * 2; dk[i] = rand();
    const b = 0.14 * (0.4 + rand());
    debris.col.set([0.75 * b, 0.6 * b, 0.45 * b], i * 3);
    debris.size[i] = 0.5 + rand() * 1.4;
}
storm.add(debris.pts);

const NC = lowPower ? 2600 : 6000;
const cloud = pointCloud(NC, 300);
const cr = new Float32Array(NC), cth = new Float32Array(NC), cy = new Float32Array(NC);
for (let i = 0; i < NC; i++) {
    const anvil = rand() < 0.35;
    cr[i] = anvil ? 30 + Math.sqrt(rand()) * 85 : 2 + Math.sqrt(rand()) * 55;
    cth[i] = rand() * Math.PI * 2;
    cy[i] = anvil ? 12 + rand() * 6 : rand() * 5;
    const b = 0.06 * (0.5 + rand());
    cloud.col.set([0.5 * b, 0.58 * b, 0.72 * b], i * 3);
    cloud.size[i] = anvil ? 10 + rand() * 14 : 5 + rand() * 10;
}
storm.add(cloud.pts);

// low dust haze over the ground
{
    const n = lowPower ? 1500 : 3000;
    const haze = pointCloud(n, 300);
    for (let i = 0; i < n; i++) {
        const r = Math.sqrt(rand()) * 170, a = rand() * Math.PI * 2;
        haze.pos.set([Math.cos(a) * r, rand() * 2.5, Math.sin(a) * r], i * 3);
        const b = 0.018 * (0.5 + rand());
        haze.col.set([0.7 * b, 0.62 * b, 0.55 * b], i * 3);
        haze.size[i] = 4 + rand() * 8;
    }
    storm.add(haze.pts);
}

// lightning
const BOLT_SEG = 28;
const boltGeo = new THREE.BufferGeometry();
const boltPos = new Float32Array(BOLT_SEG * 3);
boltGeo.setAttribute('position', new THREE.BufferAttribute(boltPos, 3).setUsage(THREE.DynamicDrawUsage));
const boltMat = new THREE.LineBasicMaterial({ color: 0xdfe9ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
const bolt = new THREE.Line(boltGeo, boltMat);
bolt.frustumCulled = false;
storm.add(bolt);

let flash = 0, nextStrike = 2.5, restrike = -1;

function strike() {
    const a = rand() * Math.PI * 2, r = 8 + rand() * 40;
    let x = Math.cos(a) * r, z = Math.sin(a) * r, y = H + 2;
    const ground = rand() < 0.6;
    const ex = x + (rand() - 0.5) * 40, ez = z + (rand() - 0.5) * 40;
    for (let i = 0; i < BOLT_SEG; i++) {
        const f = i / (BOLT_SEG - 1);
        const jx = (rand() - 0.5) * 7, jz = (rand() - 0.5) * 7;
        if (ground) boltPos.set([x + (ex - x) * f * 0.3 + jx, y - f * (H + 2), z + (ez - z) * f * 0.3 + jz], i * 3);
        else boltPos.set([x + (ex - x) * f + jx, y - 4 + (rand() - 0.5) * 4, z + (ez - z) * f + jz], i * 3);
    }
    boltGeo.attributes.position.needsUpdate = true;
    flash = 1;
}

function updateStorm(dt, t) {
    const bx = Math.sin(t * 0.07) * 6;

    for (let i = 0; i < NF; i++) {
        let h = fh[i] + dt * (0.05 + 0.07 * fsp[i]);
        if (h > 1) h -= 1;
        fh[i] = h;
        const rad = (1.0 + 17 * Math.pow(h, 2.4)) * (0.7 + 0.6 * fj[i]) + (h < 0.04 ? (0.04 - h) * 60 : 0);
        const th = fth[i] + dt * (1.7 / (0.22 + h)) * (0.8 + 0.4 * fsp[i]);
        fth[i] = th;
        const ax = Math.sin(t * 0.35 + h * 2.2) * 6 * h + Math.sin(t * 1.1 + h * 7) * 0.9 * h + bx;
        const az = Math.cos(t * 0.3 + h * 1.8) * 4.5 * h;
        const k = i * 3;
        funnel.pos[k] = ax + rad * Math.cos(th);
        funnel.pos[k + 1] = h * H;
        funnel.pos[k + 2] = az + rad * Math.sin(th);
    }
    funnel.geo.attributes.position.needsUpdate = true;

    for (let i = 0; i < ND; i++) {
        let u = du[i] + dt * (0.08 + 0.1 * dk[i]);
        if (u > 1) u -= 1;
        du[i] = u;
        const th = dth[i] + dt * (2.8 - 1.8 * u) * (0.7 + dk[i]);
        dth[i] = th;
        const r = 2 + 16 * u;
        const k = i * 3;
        debris.pos[k] = bx + r * Math.cos(th);
        debris.pos[k + 1] = Math.sin(u * Math.PI) * (2 + 9 * dk[i]);
        debris.pos[k + 2] = r * Math.sin(th);
    }
    debris.geo.attributes.position.needsUpdate = true;

    for (let i = 0; i < NC; i++) {
        const r = cr[i];
        const th = cth[i] + dt * 0.28 * (14 / (r + 6) + 0.05);
        cth[i] = th;
        const k = i * 3;
        cloud.pos[k] = bx * 0.5 + r * Math.cos(th);
        cloud.pos[k + 1] = H + 4 + cy[i] - 9 * Math.exp(-r / 9) + Math.sin(th * 3 + r * 0.2) * 1.2;
        cloud.pos[k + 2] = r * Math.sin(th);
    }
    cloud.geo.attributes.position.needsUpdate = true;

    nextStrike -= dt;
    if (nextStrike <= 0) {
        strike();
        if (rand() < 0.55) restrike = 0.09 + rand() * 0.12;
        nextStrike = 1.6 + rand() * 4.5;
    }
    if (restrike > 0) { restrike -= dt; if (restrike <= 0) strike(); }
    flash = Math.max(0, flash - dt * 7);
    const f = flash * (0.6 + 0.4 * rand());
    boltMat.opacity = f;
    cloud.mat.uniforms.uBoost.value = 1 + f * 9;
    funnel.mat.uniforms.uBoost.value = 1 + f * 1.8;
    debris.mat.uniforms.uBoost.value = 1 + f * 1.2;
}

// ---------------------------------------------------------------- camera path

// One keyframe per <section data-scene>. `off` slides the subject sideways on screen
// (negative = subject on the right) so it sits beside the text, not under it.
const KEYS = [
    { pos: [0, 4, 80], focus: [0, 0, 0], off: -24 },                         // hero
    { pos: [54, 24, 50], focus: [0, 0, 0], off: 22 },                        // about
    { pos: [-66, 44, 44], focus: [0, -4, 0], off: 0 },                       // education
    { pos: [10, -4, 27], focus: [0, 0, 0], off: 9 },                         // research (inside the swarm)
    { pos: [T.x - 34, T.y + 30, T.z + 128], focus: [T.x, T.y + 54, T.z], off: -20 }, // field: tornado
    { pos: [T.x + 70, T.y + 66, T.z + 64], focus: [T.x, T.y + 46, T.z], off: 32 },   // internships: into the cloud
    { pos: [100, 26, 200], focus: [80, -8, -45], off: 0 },                   // skills: pull back
    { pos: [30, 130, 430], focus: [80, -10, -50], off: -50 },                // publications: deep space
];

let posCurve, targetCurve;

function buildCurves() {
    const wide = innerWidth / innerHeight > 1.15;
    const up = new THREE.Vector3(0, 1, 0);
    const posPts = [], tgtPts = [];
    for (const k of KEYS) {
        const p = new THREE.Vector3(...k.pos), f = new THREE.Vector3(...k.focus);
        if (!wide) p.sub(f).multiplyScalar(1.4).add(f); // portrait: step back so text stays readable
        const right = new THREE.Vector3().subVectors(f, p).cross(up).normalize();
        posPts.push(p);
        tgtPts.push(f.clone().addScaledVector(right, wide ? k.off : 0));
    }
    swarm.mat.uniforms.uOpacity.value = wide ? 1 : 0.55;
    skeleton.material.opacity = wide ? 1 : 0.5;
    trail.material.opacity = wide ? 1 : 0.5;
    posCurve = new THREE.CatmullRomCurve3(posPts, false, 'centripetal');
    targetCurve = new THREE.CatmullRomCurve3(tgtPts, false, 'centripetal');
}
buildCurves();

const sections = Array.from(document.querySelectorAll('section[data-scene]'));

let tops = [];

// Section offsets are cached; reading layout every frame would force reflows.
function measureSections() {
    const maxScroll = document.documentElement.scrollHeight - innerHeight;
    tops = sections.map((s) => Math.min(s.offsetTop, maxScroll));
}
measureSections();
new ResizeObserver(measureSections).observe(document.body);

function scrollIndex() {
    const y = scrollY;
    if (y <= tops[0]) return 0;
    for (let i = 0; i < tops.length - 1; i++) {
        if (y < tops[i + 1]) return i + (y - tops[i]) / Math.max(1, tops[i + 1] - tops[i]);
    }
    return tops.length - 1;
}

let sCur = scrollIndex();
const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
addEventListener('pointermove', (e) => {
    mouse.tx = e.clientX / innerWidth - 0.5;
    mouse.ty = e.clientY / innerHeight - 0.5;
});

const camPos = new THREE.Vector3(), camTgt = new THREE.Vector3(), camRight = new THREE.Vector3(), camUp = new THREE.Vector3();

function updateCamera(dt, t) {
    sCur += (scrollIndex() - sCur) * (1 - Math.exp(-dt * 2.6));
    const u = clamp(sCur / (KEYS.length - 1), 0, 1);
    posCurve.getPoint(u, camPos);
    targetCurve.getPoint(u, camTgt);

    if (!reduced) {
        mouse.x += (mouse.tx - mouse.x) * (1 - Math.exp(-dt * 2));
        mouse.y += (mouse.ty - mouse.y) * (1 - Math.exp(-dt * 2));
        camRight.subVectors(camTgt, camPos).cross(camera.up).normalize();
        camUp.crossVectors(camRight, camTgt.clone().sub(camPos)).normalize();
        camPos.addScaledVector(camRight, mouse.x * 6 + Math.sin(t * 0.11) * 2.5);
        camPos.addScaledVector(camUp, -mouse.y * 4 + Math.sin(t * 0.07) * 1.5);
    }
    camera.position.copy(camPos);
    camera.lookAt(camTgt);
    sky.position.copy(camPos);
}

// ---------------------------------------------------------------- HUD readout

const el = {
    x: document.getElementById('rx'), y: document.getElementById('ry'), z: document.getElementById('rz'),
    t: document.getElementById('rt'), s: document.getElementById('rs'),
};
const fmt = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(3);

function spread() {
    let mx = 0, my = 0, mz = 0, n = 400;
    const idx = [];
    for (let i = 0; i < n; i++) idx.push(1 + ((i * 7919) % (NL - 1)));
    for (const i of idx) { mx += state[i * 3]; my += state[i * 3 + 1]; mz += state[i * 3 + 2]; }
    mx /= n; my /= n; mz /= n;
    let v = 0;
    for (const i of idx) {
        const a = state[i * 3] - mx, b = state[i * 3 + 1] - my, c = state[i * 3 + 2] - mz;
        v += a * a + b * b + c * c;
    }
    return Math.sqrt(v / n);
}

// ---------------------------------------------------------------- loop

const clock = new THREE.Clock();
let simT = 0, frame = 0, ready = false;
let perfFrames = 0, perfStart = 0;

function adaptResolution(now) {
    if (!perfStart) { perfStart = now; return; }
    perfFrames++;
    const span = now - perfStart;
    if (span < 1500) return;
    const fps = perfFrames * 1000 / span;
    perfFrames = 0; perfStart = now;
    if (fps < 45 && pixelRatio > 1) {
        pixelRatio = Math.max(1, pixelRatio - 0.25);
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(innerWidth, innerHeight);
        for (const u of prUniforms) u.value = pixelRatio;
    }
}
const SPEED = reduced ? 0.4 : 0.85;

function tick() {
    const dt = Math.min(clock.getDelta(), 1 / 30);
    const t = clock.elapsedTime;
    simT += dt * SPEED;

    updateLorenz(dt * SPEED);
    updateStorm(dt * (reduced ? 0.5 : 1), t);
    lorenz.rotation.y = Math.sin(t * 0.045) * 0.28;
    updateCamera(dt, t);

    starMat.uniforms.uTime.value = t;

    if (frame++ % 6 === 0) {
        el.x.textContent = fmt(state[0]);
        el.y.textContent = fmt(state[1]);
        el.z.textContent = fmt(state[2]);
        el.t.textContent = simT.toFixed(2);
        el.s.textContent = spread().toFixed(3);
    }

    renderer.render(scene, camera);
    adaptResolution(performance.now());
    if (!ready) { ready = true; dispatchEvent(new Event('scene-ready')); }
    requestAnimationFrame(tick);
}

addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    buildCurves();
});

requestAnimationFrame(tick);

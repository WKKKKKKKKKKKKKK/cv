// Background scene: nebula sky, starfield, Lorenz attractor swarm and a volumetric supercell tornado.
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
//
// A raymarched supercell: rotating wall cloud and storm base, condensation funnel,
// debris cloud and a rain shaft, lit by a back-light, sky ambient and lightning.
// It is costly per pixel, so it renders into a reduced-resolution target that is
// composited over the scene.

const T = new THREE.Vector3(170, -42, -110);
const H = 74;
const BOX_MIN = new THREE.Vector3(-130, -2, -150), BOX_MAX = new THREE.Vector3(185, 146, 130);
let volScale = lowPower ? 0.4 : 0.55; // lowered first when frames drop

// Tileable 3D noise: R = gradient noise (2 octaves), G = inverted Worley (2 octaves).
function noiseTexture(N) {
    const data = new Uint8Array(N * N * N * 2);

    function gradNoise(P) {
        const g = new Float32Array(P * P * P * 3);
        for (let i = 0; i < P * P * P; i++) {
            const z = rand() * 2 - 1, a = rand() * Math.PI * 2, s = Math.sqrt(1 - z * z);
            g[i * 3] = s * Math.cos(a); g[i * 3 + 1] = s * Math.sin(a); g[i * 3 + 2] = z;
        }
        const out = new Float32Array(N * N * N);
        const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
        for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
            const fx = x / N * P, fy = y / N * P, fz = z / N * P;
            const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
            const tx = fx - ix, ty = fy - iy, tz = fz - iz;
            let v = 0;
            for (let c = 0; c < 8; c++) {
                const dx = c & 1, dy = (c >> 1) & 1, dz = c >> 2;
                const gi = (((iz + dz) % P) * P * P + ((iy + dy) % P) * P + ((ix + dx) % P)) * 3;
                const dot = g[gi] * (tx - dx) + g[gi + 1] * (ty - dy) + g[gi + 2] * (tz - dz);
                const wx = dx ? fade(tx) : 1 - fade(tx), wy = dy ? fade(ty) : 1 - fade(ty), wz = dz ? fade(tz) : 1 - fade(tz);
                v += dot * wx * wy * wz;
            }
            out[(z * N + y) * N + x] = v;
        }
        return out;
    }

    function worley(P) {
        const pts = new Float32Array(P * P * P * 3);
        for (let i = 0; i < pts.length; i++) pts[i] = rand();
        const out = new Float32Array(N * N * N);
        for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
            const fx = x / N * P, fy = y / N * P, fz = z / N * P;
            const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
            let best = 9;
            for (let c = 0; c < 27; c++) {
                const ox = (c % 3) - 1, oy = ((c / 3 | 0) % 3) - 1, oz = (c / 9 | 0) - 1;
                const cx = ix + ox, cy = iy + oy, cz = iz + oz;
                const pi = ((((cz % P) + P) % P) * P * P + (((cy % P) + P) % P) * P + (((cx % P) + P) % P)) * 3;
                const ddx = cx + pts[pi] - fx, ddy = cy + pts[pi + 1] - fy, ddz = cz + pts[pi + 2] - fz;
                const d = ddx * ddx + ddy * ddy + ddz * ddz;
                if (d < best) best = d;
            }
            out[(z * N + y) * N + x] = 1 - Math.min(1, Math.sqrt(best));
        }
        return out;
    }

    const p1 = gradNoise(8), p2 = gradNoise(16), w1 = worley(6), w2 = worley(12);
    for (let i = 0; i < N * N * N; i++) {
        data[i * 2] = clamp(128 + (p1[i] * 0.68 + p2[i] * 0.32) * 300, 0, 255);
        data[i * 2 + 1] = clamp((w1[i] * 0.7 + w2[i] * 0.3) * 255, 0, 255);
    }
    const tex = new THREE.Data3DTexture(data, N, N, N);
    tex.format = THREE.RGFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    return tex;
}

const sunDir = new THREE.Vector3(-140, 60, -620).sub(T).normalize(); // matches the sun sprite

const volUniforms = {
    tNoise: { value: noiseTexture(lowPower ? 48 : 64) },
    uT: { value: 0 },
    uH: { value: H },
    uCam: { value: new THREE.Vector3() },
    uBoxMin: { value: BOX_MIN },
    uBoxMax: { value: BOX_MAX },
    uSun: { value: sunDir },
    uFlash: { value: 0 },
    uBoltA: { value: new THREE.Vector3(0, H, 0) },
    uBoltB: { value: new THREE.Vector3(0, H, 0) },
    uSteps: { value: lowPower ? 96 : 120 },
};

const volume = new THREE.Mesh(
    new THREE.BoxGeometry(BOX_MAX.x - BOX_MIN.x, BOX_MAX.y - BOX_MIN.y, BOX_MAX.z - BOX_MIN.z)
        .translate((BOX_MAX.x + BOX_MIN.x) / 2, (BOX_MAX.y + BOX_MIN.y) / 2, (BOX_MAX.z + BOX_MIN.z) / 2),
    new THREE.ShaderMaterial({
        uniforms: volUniforms,
        vertexShader: /* glsl */`
            varying vec3 vLocal;
            void main() {
                vLocal = position;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: /* glsl */`
            precision highp sampler3D;
            uniform sampler3D tNoise;
            uniform float uT, uH, uFlash;
            uniform int uSteps;
            uniform vec3 uCam, uBoxMin, uBoxMax, uSun, uBoltA, uBoltB;
            varying vec3 vLocal;

            mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
            float pn(vec3 p) { return texture(tNoise, p).r; }
            float wn(vec3 p) { return texture(tNoise, p).g; }

            // Low-precipitation supercell (local units, cloud base at uH): a rotating updraft,
            // tilted downshear, wrapped in irregular striated bands (the mesocyclone); a
            // cumulonimbus tower carries it up into the anvil. A localized wall cloud hangs
            // under the rear of the updraft with a tapering condensation funnel below it.
            // Rain is light and kept off to the forward flank. Everything turns
            // counter-clockwise seen from above, as in the northern hemisphere
            // (rot(-a) spins a pattern that way).
            const vec2 MESO = vec2(8.0, -6.0);
            const vec2 TILT = vec2(0.30, -0.12); // horizontal drift of the updraft axis per unit height
            const vec2 FFD = vec2(70.0, -36.0);

            // tornado axis: top at the wall cloud centre, base trailing slightly behind
            vec2 axisAt(float y) {
                float h = clamp(y / (uH - 14.0), 0.0, 1.0);
                vec2 w = vec2(-6.0, 6.0) + vec2(sin(uT * 0.07), cos(uT * 0.05)) * 3.0;
                return w + (vec2(-5.0, 3.0) + vec2(sin(uT * 0.3 + h * 2.0) * 2.0, cos(uT * 0.25 + h * 1.6) * 1.5)) * (1.0 - h);
            }

            // x: extinction density, y: share of it that is dust
            vec2 density(vec3 p, bool detail) {
                float y = p.y, z = y - uH, dens = 0.0, dust = 0.0;
                float hw = uH - 14.0; // wall cloud bottom
                float lo = pn(p * 0.0055 + vec3(0.0, uT * 0.0015, 0.0));
                vec2 axis = MESO + TILT * clamp(z, 0.0, 70.0); // updraft axis at this height

                // mesocyclone: irregular bands spiralling up a tilted rotating updraft
                vec2 mq = p.xz - axis;
                float rm = length(mq);
                if (z > -4.0 && z < 46.0 && rm < 82.0) {
                    float ang = atan(mq.y, mq.x);
                    vec2 rq = rot(-uT * 0.05) * mq;
                    vec3 bp = vec3(rq.x, y, rq.y);
                    float m = detail ? pn(vec3(mq.x * 0.012, z * 0.03, mq.y * 0.012) + 0.37) : lo;
                    // band spacing, phase and lip size all wander, so the plates are not concentric
                    float s = fract(z / (5.5 + 3.5 * m) + ang / 6.2831853 + uT * 0.035 + (m - 0.5) * 0.9);
                    float lip = pow(1.0 - s, 2.5) * (6.0 + 8.0 * m) * (0.7 + 0.3 * sin(ang * 2.0 + m * 5.0))
                              * smoothstep(38.0, 6.0, z);
                    float Rm = mix(56.0, 30.0, smoothstep(0.0, 40.0, z)) * (1.0 + 0.1 * sin(ang + 0.8) + 0.05 * sin(ang * 3.0 + m * 4.0))
                             + lip + (lo - 0.5) * 12.0;
                    float bill = detail ? wn(bp * 0.02 + 0.31) : 0.6;
                    float fine = detail ? wn(bp * 0.065 + 0.7) : 0.6;
                    float edge = rm + (1.0 - bill) * 4.0 + (1.0 - fine) * 1.5; // billowy, ragged boundary
                    float body = smoothstep(Rm + 1.5, Rm - 3.5, edge)
                               * smoothstep(-1.0, 3.0, z + (bill - 0.5) * 5.0)
                               * smoothstep(46.0, 34.0, z + (lo - 0.5) * 10.0);
                    // the grooves between plates are thinner than the plates themselves
                    body *= mix(1.0, 0.4 + 0.6 * smoothstep(0.0, 0.45, s), smoothstep(Rm - 16.0, Rm - 3.0, rm));
                    dens += max(body * 1.25 - (1.0 - bill) * 0.2 - (1.0 - fine) * 0.06, 0.0) * 0.34;
                }

                // cumulonimbus tower carrying the updraft up to the anvil, with a modest overshooting top
                if (z > 24.0 && z < 68.0 && rm < 42.0) {
                    float tb = detail ? wn(p * 0.022 + 0.11) : 0.6;
                    float tb2 = detail ? wn(p * 0.065 + 0.4) : 0.6;
                    float Rt = 25.0 + (lo - 0.5) * 10.0 - smoothstep(52.0, 66.0, z) * 15.0;
                    float tower = smoothstep(Rt + 3.0, Rt - 7.0, rm + (1.0 - tb) * 9.0 + (1.0 - tb2) * 3.0)
                                * smoothstep(24.0, 34.0, z) * smoothstep(68.0, 58.0, z + (tb - 0.5) * 8.0);
                    dens += max(tower * 1.3 - (1.0 - tb) * 0.35, 0.0) * 0.34;
                }

                // anvil spreading downwind at the tropopause; its base dips into the tower
                float ay = uH + 50.0;
                vec2 aq = p.xz - (MESO + TILT * 50.0);
                float ar = length((aq - vec2(30.0, -12.0)) * vec2(0.75, 1.0));
                float stem = 26.0 * exp(-dot(aq, aq) / 900.0);
                if (z > 38.0 - stem && z < 59.0 && ar < 125.0) {
                    float an = detail ? wn(p * 0.012 + 0.53) : 0.6;
                    float sheet = smoothstep(ay - 9.0 + an * 6.0 - stem, ay - 3.0 - stem * 0.8, y) * smoothstep(ay + 7.0, ay + 1.0 + an * 3.0, y)
                                * smoothstep(122.0, 72.0, ar + (lo - 0.5) * 50.0);
                    dens += max(sheet * 1.3 - (1.0 - an) * 0.45 - (1.0 - lo) * 0.2, 0.0) * 0.28;
                }

                // localized wall cloud under the rear of the updraft
                vec2 wq = p.xz - axisAt(hw);
                float rw = length(wq);
                if (y > hw - 4.0 && y < uH + 2.0 && rw < 34.0) {
                    vec2 rq = rot(-uT * 0.12) * wq;
                    float n = detail ? pn(vec3(rq.x * 0.035, y * 0.05, rq.y * 0.035)) : 0.5;
                    float Rw = 23.0 - (uH - y) * 0.6 + (n - 0.5) * 9.0;
                    float wcd = smoothstep(Rw + 3.0, Rw - 4.0, rw) * smoothstep(hw - 4.0 + n * 8.0, hw + 4.0, y);
                    dens += wcd * 0.55;
                }

                // tapering condensation funnel with rotating, ragged edges
                if (y < hw + 3.0 && y > -1.0) {
                    float h = clamp(y / hw, 0.0, 1.0);
                    vec2 fq = p.xz - axisAt(y);
                    float R = 3.2 + 4.5 * pow(h, 1.6) + 6.0 * pow(h, 5.0);
                    float d = length(fq);
                    if (d < R * 1.8 + 3.0) {
                        vec2 sq = rot(-(uT * 1.4 + y * 0.04)) * fq;
                        vec3 fp = vec3(sq.x * 0.09, y * 0.03 - uT * 0.15, sq.y * 0.09);
                        float n1 = detail ? pn(fp) : 0.5;
                        float n2 = detail ? pn(fp * 3.1 + 0.4) : 0.5;
                        float dd = d + ((n1 - 0.5) * 0.8 + (n2 - 0.5) * 0.4) * R;
                        float tw = smoothstep(R, R * 0.55, dd) * 2.2 * mix(0.45, 1.0, smoothstep(0.0, 12.0, y));
                        dens += tw;
                        dust += tw * 0.3 * (1.0 - h);
                    }
                }

                // debris whirl where the vortex meets the ground
                vec2 dq = p.xz - axisAt(0.0);
                float dr = length(dq);
                if (y < 16.0 && dr < 30.0) {
                    vec2 sq = rot(-uT * 1.8 + y * 0.06) * dq;
                    float n = detail ? pn(vec3(sq.x * 0.05, y * 0.045 - uT * 0.18, sq.y * 0.05)) : 0.5;
                    float shell = exp(-max(y, 0.0) / (5.0 + 6.0 * n)) * smoothstep(15.0, 2.0, dr + (n - 0.5) * 10.0 - y * 0.3);
                    float d = max(shell * 1.3 - 0.35 - (1.0 - n) * 0.4, 0.0) * 0.5;
                    dens += d; dust += d;
                }

                // forward flank, off to one side: billowy cloud over a light rain curtain
                vec2 fq2 = p.xz - FFD;
                float rf = length(fq2 * vec2(0.8, 1.0));
                if (rf < 75.0) {
                    if (z > -4.0 && z < 40.0) {
                        float b = detail ? wn(p * 0.018 + 0.2) : 0.6;
                        float sh = smoothstep(56.0, 26.0, rf + (lo - 0.5) * 30.0) * smoothstep(-2.0 + b * 5.0, 4.0, z)
                                 * smoothstep(40.0, 22.0 + lo * 10.0, z);
                        dens += max(sh * 1.3 - (1.0 - b) * 0.55 - (1.0 - lo) * 0.2, 0.0) * 0.3;
                    }
                    if (z < 0.0) {
                        float rr = length(fq2 - vec2(0.25, 0.1) * -z);
                        float rad = 26.0 + -z * 0.12;
                        float n = detail ? pn(vec3(p.x * 0.022, y * 0.011 + uT * 0.05, p.z * 0.022)) : 0.5;
                        float shaft = smoothstep(rad + 8.0, rad - 20.0, rr + (n - 0.5) * 30.0) * smoothstep(2.0, -8.0, z)
                                    * mix(0.5, 1.0, smoothstep(0.0, 40.0, y));
                        dens += shaft * 0.016 * (0.3 + n) * (detail ? 0.5 + pn(vec3(p.x * 0.07, y * 0.004 + uT * 0.05, p.z * 0.07)) : 1.0);
                    }
                }

                // thin inflow haze under the base
                float rh = length(p.xz);
                if (z < 0.0 && rh < 115.0) {
                    float d = 0.0035 * smoothstep(115.0, 50.0, rh) * smoothstep(0.0, -25.0, z) * smoothstep(-2.0, 10.0, y);
                    dens += d; dust += d * 0.5;
                }

                // dust skirt over the ground, drawn in toward the vortex
                if (detail && y < 5.0 && dr < 90.0) {
                    float n = pn(vec3(dq.x * 0.02, y * 0.05, dq.y * 0.02) + vec3(0.0, 0.0, uT * 0.01));
                    float d = exp(-max(y, 0.0) / 1.6) * smoothstep(90.0, 20.0, dr) * max(n - 0.4, 0.0) * 0.06;
                    dens += d; dust += d;
                }
                return vec2(dens, dust);
            }

            float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5) / 12.566; }

            void main() {
                vec3 ro = uCam, rd = normalize(vLocal - uCam);
                vec3 inv = 1.0 / rd;
                vec3 t0 = (uBoxMin - ro) * inv, t1 = (uBoxMax - ro) * inv;
                vec3 tmn = min(t0, t1), tmx = max(t0, t1);
                float tn = max(max(max(tmn.x, tmn.y), tmn.z), 0.0);
                float tf = min(min(tmx.x, tmx.y), tmx.z);
                if (tf <= tn) discard;

                float cosA = dot(rd, uSun);
                float phase = mix(hg(cosA, 0.55), hg(cosA, -0.2), 0.4);
                vec3 sunCol = vec3(1.0, 0.82, 0.64) * 4.6;
                vec3 fillCol = vec3(0.40, 0.46, 0.60);
                vec3 boltCol = vec3(0.72, 0.78, 1.0);
                vec3 ba = uBoltB - uBoltA;
                float baL = max(dot(ba, ba), 1e-3);

                float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
                float t = tn + ign * clamp(tn * 0.013, 0.7, 4.5);
                vec3 col = vec3(0.0);
                float Tr = 1.0;
                const float K = 0.55; // extinction per unit density
                for (int i = 0; i < 200; i++) {
                    if (i >= uSteps || t > tf || Tr < 0.02) break;
                    vec3 p = ro + rd * t;
                    float dt = clamp(t * 0.013, 0.7, 4.5);
                    // finer steps around the tornado and debris
                    float da = length(p.xz - axisAt(p.y));
                    if (p.y < uH && da < 30.0) dt = min(dt, 0.6 + da * 0.1);
                    vec2 s = density(p, true);
                    if (s.x > 0.002) {
                        // two-tap shadow toward the sun and a crude sky occlusion;
                        // thin rain and dust skip them, they barely change the look
                        float sh = 6.0, up = 4.0;
                        if (s.x > 0.05) {
                            sh = density(p + uSun * 4.0, false).x * 4.0 + density(p + uSun * 14.0, false).x * 12.0;
                            up = density(p + vec3(0.0, 9.0, 0.0), false).x * 9.0;
                        }
                        float powder = 1.0 - exp(-s.x * K * 6.0);
                        float dustF = s.x > 0.0 ? s.y / s.x : 0.0;

                        vec3 alb = mix(vec3(0.80, 0.84, 0.90), vec3(0.42, 0.36, 0.30), dustF);
                        float hgt = clamp((p.y - uH + 6.0) / 40.0, 0.0, 1.0);
                        vec3 amb = mix(vec3(0.018, 0.021, 0.03), vec3(0.09, 0.105, 0.15), hgt) + fillCol * exp(-up * K * 0.5) * (0.35 + 0.65 * hgt);
                        float sunT = exp(-sh * K) + 0.35 * exp(-sh * K * 0.25); // second term: light scattered more than once
                        vec3 lum = sunCol * sunT * phase * mix(0.4, 1.0, powder) + amb + fillCol * (0.12 + 0.12 * dustF);

                        float hseg = clamp(dot(p - uBoltA, ba) / baL, 0.0, 1.0);
                        float dseg = length(p - uBoltA - ba * hseg);
                        lum += boltCol * uFlash * (exp(-dseg / 12.0) * 2.6 + exp(-length(p - uBoltA) / 38.0) * 1.4);

                        float Ts = exp(-s.x * K * dt);
                        col += Tr * alb * lum * (1.0 - Ts);
                        Tr *= Ts;
                        t += s.x < 0.02 ? dt * 1.6 : dt; // haze and rain tolerate coarser steps
                    } else {
                        t += dt * 2.0;
                    }
                }
                gl_FragColor = vec4(col, 1.0 - Tr);
            }`,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        transparent: true,
        blending: THREE.NoBlending,
    })
);
volume.position.copy(T);
volume.frustumCulled = false;
const volScene = new THREE.Scene();
volScene.add(volume);

const volTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });

function sizeVolume() {
    volTarget.setSize(Math.max(1, Math.round(innerWidth * pixelRatio * volScale)),
                      Math.max(1, Math.round(innerHeight * pixelRatio * volScale)));
}
sizeVolume();

// The volume texture is laid over the scene with premultiplied alpha.
const stormLayer = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { tVol: { value: volTarget.texture }, uTexel: { value: new THREE.Vector2() } },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */`
        uniform sampler2D tVol;
        varying vec2 vUv;
        uniform vec2 uTexel;
        void main() {
            vec2 o = uTexel * 0.5;
            gl_FragColor = 0.25 * (texture2D(tVol, vUv + vec2(-o.x, -o.y)) + texture2D(tVol, vUv + vec2(o.x, -o.y))
                                 + texture2D(tVol, vUv + vec2(-o.x, o.y)) + texture2D(tVol, vUv + vec2(o.x, o.y)));
        }`,
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
}));
stormLayer.frustumCulled = false;
stormLayer.renderOrder = 1;
scene.add(stormLayer);

const stormBounds = new THREE.Sphere(new THREE.Vector3(T.x + 25, T.y + 60, T.z - 10), 210);
const frustum = new THREE.Frustum(), projView = new THREE.Matrix4();

function renderStorm() {
    camera.updateMatrixWorld();
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    stormLayer.visible = frustum.intersectsSphere(stormBounds);
    if (!stormLayer.visible) return;
    volUniforms.uCam.value.copy(camera.position).sub(T);
    stormLayer.material.uniforms.uTexel.value.set(1 / volTarget.width, 1 / volTarget.height);
    renderer.setRenderTarget(volTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(volScene, camera);
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x04050a, 1);

    // the attractor's glow belongs in front of the storm only when it is nearer
    const front = camera.position.distanceTo(lorenz.position) < camera.position.distanceTo(stormBounds.center) ? 2 : 0;
    for (const o of lorenz.children) o.renderOrder = front;
}

// ---------------------------------------------------------------- lightning
//
// Branched channels from midpoint displacement, drawn as screen-space ribbons.
// The stepped leader creeps down first, then the return stroke lights the channel
// (and the cloud around it), sometimes followed by restrikes down the same path.

const MAX_SEG = 1400;
const boltGeo = new THREE.BufferGeometry();
const bA = new Float32Array(MAX_SEG * 4 * 3), bB = new Float32Array(MAX_SEG * 4 * 3);
const bCorner = new Float32Array(MAX_SEG * 4 * 2), bBright = new Float32Array(MAX_SEG * 4), bOrder = new Float32Array(MAX_SEG * 4);
{
    const idx = new Uint16Array(MAX_SEG * 6);
    for (let i = 0; i < MAX_SEG; i++) {
        idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
        bCorner.set([0, -1, 0, 1, 1, -1, 1, 1], i * 8);
    }
    boltGeo.setIndex(new THREE.BufferAttribute(idx, 1));
}
boltGeo.setAttribute('position', new THREE.BufferAttribute(bA, 3).setUsage(THREE.DynamicDrawUsage));
boltGeo.setAttribute('aB', new THREE.BufferAttribute(bB, 3).setUsage(THREE.DynamicDrawUsage));
boltGeo.setAttribute('aCorner', new THREE.BufferAttribute(bCorner, 2));
boltGeo.setAttribute('aBright', new THREE.BufferAttribute(bBright, 1).setUsage(THREE.DynamicDrawUsage));
boltGeo.setAttribute('aOrder', new THREE.BufferAttribute(bOrder, 1).setUsage(THREE.DynamicDrawUsage));

const boltMat = new THREE.ShaderMaterial({
    uniforms: { uRes: { value: new THREE.Vector2(1, 1) }, uPR: { value: pixelRatio }, uFlash: { value: 0 }, uProg: { value: 1 }, uFade: { value: 1 } },
    vertexShader: /* glsl */`
        attribute vec3 aB;
        attribute vec2 aCorner;
        attribute float aBright, aOrder;
        uniform vec2 uRes;
        uniform float uPR, uProg;
        varying float vSide, vBright;
        void main() {
            vec4 mA = modelViewMatrix * vec4(position, 1.0), mB = modelViewMatrix * vec4(aB, 1.0);
            vec4 cA = projectionMatrix * mA, cB = projectionMatrix * mB;
            if (cA.w <= 0.1 || cB.w <= 0.1 || aOrder > uProg) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
            vec2 hres = uRes * 0.5;
            vec2 sA = cA.xy / cA.w * hres, sB = cB.xy / cB.w * hres;
            vec2 dir = normalize(sB - sA + vec2(1e-4, 0.0));
            vec2 nrm = vec2(-dir.y, dir.x);
            vec4 c = aCorner.x < 0.5 ? cA : cB;
            float w = (3.0 + 11.0 * aBright) * uPR * clamp(140.0 / -mA.z, 0.5, 2.2);
            c.xy += (nrm * aCorner.y + dir * (aCorner.x * 2.0 - 1.0) * 0.1) * w / hres * c.w;
            gl_Position = c;
            vSide = aCorner.y;
            vBright = aBright;
        }`,
    fragmentShader: /* glsl */`
        uniform float uFlash, uFade;
        varying float vSide, vBright;
        void main() {
            float s = abs(vSide);
            float core = smoothstep(0.14, 0.0, s);
            float glow = exp(-s * 4.5) - exp(-4.5);
            // faint branches die off first
            float b = vBright * pow(uFade, 1.0 + (1.0 - vBright) * 3.0) * uFlash;
            vec3 c = vec3(0.95, 0.97, 1.0) * core * 1.6 + vec3(0.45, 0.5, 1.0) * glow * 0.45;
            gl_FragColor = vec4(c * b, 1.0);
        }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
});
prUniforms.push(boltMat.uniforms.uPR);
const bolt = new THREE.Mesh(boltGeo, boltMat);
bolt.position.copy(T);
bolt.frustumCulled = false;
bolt.renderOrder = 3;
scene.add(bolt);

let nSeg = 0;

function jagged(a, b, levels, rough) {
    let pts = [a, b];
    const v = new THREE.Vector3(), dir = new THREE.Vector3();
    for (let l = 0; l < levels; l++) {
        const next = [];
        for (let i = 0; i < pts.length - 1; i++) {
            const p = pts[i], q = pts[i + 1];
            dir.subVectors(q, p);
            const len = dir.length();
            dir.divideScalar(len || 1);
            v.set(rand() - 0.5, rand() - 0.5, rand() - 0.5);
            v.addScaledVector(dir, -v.dot(dir)).normalize();
            next.push(p, p.clone().lerp(q, 0.4 + rand() * 0.2).addScaledVector(v, len * (l < 2 ? rough : rough * 0.6) * (0.3 + rand())));
        }
        next.push(pts[pts.length - 1]);
        pts = next;
    }
    return pts;
}

function addChannel(pts, bright, order0, order1) {
    for (let i = 0; i < pts.length - 1 && nSeg < MAX_SEG; i++, nSeg++) {
        const o = order0 + (order1 - order0) * (i / (pts.length - 1));
        for (let c = 0; c < 4; c++) {
            const k = nSeg * 4 + c;
            bA.set([pts[i].x, pts[i].y, pts[i].z], k * 3);
            bB.set([pts[i + 1].x, pts[i + 1].y, pts[i + 1].z], k * 3);
            bBright[k] = bright;
            bOrder[k] = o;
        }
    }
}

// side branches forking off a channel, mostly heading the same way it goes
function branches(main, count, bright, order0, order1, len, depth) {
    for (let n = 0; n < count; n++) {
        const i = 2 + ((rand() * (main.length * 0.75)) | 0);
        if (i >= main.length - 1) continue;
        const from = main[i];
        const d = new THREE.Vector3().subVectors(main[Math.min(main.length - 1, i + 4)], from).normalize();
        d.x += (rand() - 0.5) * 1.6; d.z += (rand() - 0.5) * 1.6; d.y += (rand() - 0.5) * 0.4;
        d.normalize();
        const to = from.clone().addScaledVector(d, len * (0.35 + rand() * 0.65));
        to.y = Math.max(to.y, 1);
        const pts = jagged(from, to, depth, 0.22);
        const o = order0 + (order1 - order0) * (i / main.length);
        addChannel(pts, bright * (0.6 + rand() * 0.4), o, o + (order1 - order0) * 0.4);
        if (depth > 3) branches(pts, 2, bright * 0.45, o, o + 0.3, len * 0.45, depth - 1);
    }
}

renderer.getDrawingBufferSize(boltMat.uniforms.uRes.value);

const MESO_C = [8, -6], FFD_C = [70, -36]; // match MESO and FFD in the volume shader
const boltA = volUniforms.uBoltA.value, boltB = volUniforms.uBoltB.value;

function strike() {
    nSeg = 0;
    const kind = rand();
    const a = rand() * Math.PI * 2, r = 8 + rand() * 40;
    const c = rand() < 0.55 ? FFD_C : MESO_C;
    const top = new THREE.Vector3(c[0] + Math.cos(a) * r, H + 4, c[1] + Math.sin(a) * r);
    if (kind < 0.55) {
        // cloud-to-ground
        const ground = new THREE.Vector3(top.x + (rand() - 0.5) * 50, 0, top.z + (rand() - 0.5) * 50);
        const main = jagged(top, ground, 7, 0.24);
        addChannel(main, 1, 0, 1);
        branches(main, 3 + ((rand() * 5) | 0), 0.45, 0, 1, 34, 5);
        boltA.copy(top); boltB.copy(ground);
    } else if (kind < 0.78) {
        // anvil crawler spreading along the underside of the base
        const b = rand() * Math.PI * 2;
        const end = new THREE.Vector3(top.x + Math.cos(b) * 85, H - 1, top.z + Math.sin(b) * 85);
        top.y = H - 1;
        const main = jagged(top, end, 7, 0.2);
        for (const p of main) p.y = Math.min(p.y, H - 0.5);
        addChannel(main, 0.75, 0, 1);
        branches(main, 6, 0.35, 0, 1, 30, 4);
        boltA.copy(top); boltB.copy(end);
    } else {
        // intracloud: no channel in view, the cloud glows from inside
        top.y = H + 8 + rand() * 25;
        boltA.copy(top); boltB.copy(top);
    }
    for (const k of ['position', 'aB', 'aBright', 'aOrder']) boltGeo.attributes[k].needsUpdate = true;
    boltGeo.setDrawRange(0, nSeg * 6);
}

let flash = 0, prog = 1, nextStrike = 2.5, restrikes = 0, restrikeIn = 0, stormT = 0;

function updateStorm(dt) {
    stormT += dt;
    volUniforms.uT.value = stormT;

    nextStrike -= dt;
    if (nextStrike <= 0) {
        strike();
        prog = 0;
        flash = 0;
        restrikes = rand() < 0.6 ? 1 + ((rand() * 3) | 0) : 0;
        restrikeIn = 0.05 + rand() * 0.08;
        nextStrike = (1.4 + rand() * 3.4) * (reduced ? 2.5 : 1);
    }
    if (prog < 1) {
        prog = Math.min(1, prog + dt / 0.07); // stepped leader
        if (prog >= 1) flash = 1;              // return stroke
    } else if (restrikes > 0 && flash < 0.25) {
        restrikeIn -= dt;
        if (restrikeIn <= 0) { flash = 0.7 + rand() * 0.3; restrikes--; restrikeIn = 0.04 + rand() * 0.1; }
    }
    flash = Math.max(0, flash - dt * 6);

    const f = prog < 1 ? 0.25 : flash * (0.8 + 0.2 * rand());
    boltMat.uniforms.uProg.value = prog;
    boltMat.uniforms.uFlash.value = prog < 1 ? 0.35 : Math.min(1, f * 1.4);
    boltMat.uniforms.uFade.value = prog < 1 ? 1 : flash;
    volUniforms.uFlash.value = (prog < 1 ? 0.04 : f) * (reduced ? 0.5 : 1);
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
    { pos: [T.x + 105, T.y + 34, T.z + 92], focus: [T.x, T.y + 48, T.z], off: 32 },  // internships: under the base
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
    if (fps < 45 && volScale > 0.34) {
        volScale -= 0.07;
        sizeVolume();
    } else if (fps < 45 && pixelRatio > 1) {
        pixelRatio = Math.max(1, pixelRatio - 0.25);
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(innerWidth, innerHeight);
        for (const u of prUniforms) u.value = pixelRatio;
        sizeVolume();
        renderer.getDrawingBufferSize(boltMat.uniforms.uRes.value);
    }
}
const SPEED = reduced ? 0.4 : 0.85;

function tick() {
    const dt = Math.min(clock.getDelta(), 1 / 30);
    const t = clock.elapsedTime;
    simT += dt * SPEED;

    updateLorenz(dt * SPEED);
    updateStorm(dt * (reduced ? 0.5 : 1));
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

    renderStorm();
    renderer.render(scene, camera);
    adaptResolution(performance.now());
    if (!ready) { ready = true; dispatchEvent(new Event('scene-ready')); }
    requestAnimationFrame(tick);
}

addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    sizeVolume();
    renderer.getDrawingBufferSize(boltMat.uniforms.uRes.value);
    buildCurves();
});

requestAnimationFrame(tick);

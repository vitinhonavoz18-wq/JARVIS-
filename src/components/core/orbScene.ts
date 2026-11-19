import * as THREE from 'three';
import type { CoreState } from '@/lib/jarvis.tsx';

const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const VERT = /* glsl */ `
uniform float uTime; uniform float uAmp; uniform float uFreq;
varying vec3 vNormal; varying vec3 vView; varying float vNoise;
${NOISE}
void main(){
  float n = snoise(normal * uFreq + vec3(uTime * 0.35));
  float n2 = snoise(normal * uFreq * 2.3 - vec3(uTime * 0.6)) * 0.35;
  vNoise = n + n2;
  vec3 pos = position + normal * (vNoise * uAmp);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform vec3 uColorA; uniform vec3 uColorB; uniform vec3 uCore; uniform float uGlow; uniform float uTime;
varying vec3 vNormal; varying vec3 vView; varying float vNoise;
void main(){
  float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.2);
  vec3 col = mix(uColorA, uColorB, smoothstep(-0.6, 0.8, vNoise));
  float bands = 0.5 + 0.5 * sin(vNoise * 9.0 + uTime * 1.5);
  vec3 inner = uCore * (0.25 + 0.35 * bands);
  vec3 c = inner + col * fres * (1.4 + uGlow);
  float alpha = clamp(0.35 + fres * 1.2, 0.0, 1.0);
  gl_FragColor = vec4(c, alpha);
}`;

interface Look { a: string; b: string; core: string; amp: number; freq: number; speed: number; glow: number; spin: number }

const LOOKS: Record<CoreState, Look> = {
  idle: { a: '#008CFF', b: '#00D9FF', core: '#0A3A66', amp: 0.06, freq: 1.4, speed: 0.6, glow: 0.2, spin: 0.15 },
  listening: { a: '#00D9FF', b: '#F4F8FF', core: '#0B4E7A', amp: 0.14, freq: 2.2, speed: 1.6, glow: 0.7, spin: 0.35 },
  thinking: { a: '#7467FF', b: '#00D9FF', core: '#2A1F66', amp: 0.1, freq: 3.2, speed: 2.6, glow: 0.6, spin: 1.1 },
  speaking: { a: '#00D9FF', b: '#7467FF', core: '#123E6E', amp: 0.12, freq: 1.8, speed: 1.4, glow: 0.8, spin: 0.4 },
  executing: { a: '#008CFF', b: '#7467FF', core: '#14306B', amp: 0.09, freq: 4.0, speed: 3.2, glow: 0.7, spin: 1.6 },
  success: { a: '#2EE6A6', b: '#00D9FF', core: '#0E5A4A', amp: 0.08, freq: 1.6, speed: 1.0, glow: 1.0, spin: 0.5 },
  error: { a: '#FF5C7A', b: '#7467FF', core: '#5A1A2E', amp: 0.07, freq: 2.0, speed: 0.8, glow: 0.6, spin: 0.2 },
};

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function createOrb(canvas: HTMLCanvasElement, getState: () => CoreState, getLevel: () => number) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 4.2);

  const uniforms = {
    uTime: { value: 0 }, uAmp: { value: 0.06 }, uFreq: { value: 1.4 }, uGlow: { value: 0.2 },
    uColorA: { value: new THREE.Color(LOOKS.idle.a) }, uColorB: { value: new THREE.Color(LOOKS.idle.b) }, uCore: { value: new THREE.Color(LOOKS.idle.core) },
  };
  const sphere = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1, 48),
    new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  scene.add(sphere);

  // Anéis orbitais
  const ringMat = (color: string, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  const rings = [
    new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.006, 8, 200), ringMat('#00D9FF', 0.55)),
    new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.004, 8, 200), ringMat('#7467FF', 0.45)),
    new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.003, 8, 200), ringMat('#008CFF', 0.5)),
  ];
  rings[0].rotation.x = Math.PI / 2.4;
  rings[1].rotation.x = Math.PI / 1.8;
  rings[1].rotation.y = 0.5;
  rings[2].rotation.y = Math.PI / 2.2;
  rings.forEach((r) => scene.add(r));

  // Partículas em casca esférica (quantidade moderada)
  const count = 420;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const r = 1.9 + Math.random() * 0.5;
    const s = Math.sqrt(1 - u * u);
    pos.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], i * 3);
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const particles = new THREE.Points(pg, new THREE.PointsMaterial({ color: '#00D9FF', size: 0.015, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(particles);

  const target = { ...LOOKS.idle };
  const cur = { amp: 0.06, freq: 1.4, speed: 0.6, glow: 0.2, spin: 0.15 };
  const cA = new THREE.Color(), cB = new THREE.Color(), cC = new THREE.Color();
  let t = 0;
  let last = performance.now();
  let raf = 0;
  let visible = true;

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
  io.observe(canvas);

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!visible || document.hidden) return;
    const look = LOOKS[getState()];
    Object.assign(target, look);
    const k = 1 - Math.pow(0.02, dt);
    const level = getLevel();
    cur.amp += (target.amp + level * 0.25 - cur.amp) * k;
    cur.freq += (target.freq - cur.freq) * k;
    cur.speed += (target.speed + level * 1.5 - cur.speed) * k;
    cur.glow += (target.glow + level * 0.8 - cur.glow) * k;
    cur.spin += (target.spin - cur.spin) * k;
    t += dt * cur.speed;
    uniforms.uTime.value = t;
    uniforms.uAmp.value = cur.amp;
    uniforms.uFreq.value = cur.freq;
    uniforms.uGlow.value = cur.glow;
    uniforms.uColorA.value.lerp(cA.set(look.a), k);
    uniforms.uColorB.value.lerp(cB.set(look.b), k);
    uniforms.uCore.value.lerp(cC.set(look.core), k);
    sphere.rotation.y += dt * cur.spin * 0.4;
    rings[0].rotation.z += dt * cur.spin;
    rings[1].rotation.z -= dt * cur.spin * 0.7;
    rings[2].rotation.x += dt * cur.spin * 0.5;
    particles.rotation.y -= dt * 0.05 * (1 + cur.spin);
    const s = 1 + level * 0.08;
    sphere.scale.setScalar(s);
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    io.disconnect();
    renderer.dispose();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose?.();
    });
  };
}

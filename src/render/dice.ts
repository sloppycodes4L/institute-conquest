// A small three.js dice tray. The server already rolled; this just tumbles the cubes
// and lands them on the given faces. Attack dice: blood red. Defense dice: bone.

import * as THREE from 'three';

const FACE_TEX = new Map<string, THREE.Texture>();
function faceTex(n: number, bg: string, pip: string) {
  const k = `${n}${bg}${pip}`;
  if (FACE_TEX.has(k)) return FACE_TEX.get(k)!;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 6; g.strokeRect(3, 3, 122, 122);
  g.fillStyle = pip;
  const P: Record<number, [number, number][]> = {
    1: [[64, 64]], 2: [[34, 34], [94, 94]], 3: [[30, 30], [64, 64], [98, 98]],
    4: [[34, 34], [94, 34], [34, 94], [94, 94]], 5: [[32, 32], [96, 32], [64, 64], [32, 96], [96, 96]],
    6: [[34, 28], [94, 28], [34, 64], [94, 64], [34, 100], [94, 100]],
  };
  for (const [x, y] of P[n]) { g.beginPath(); g.arc(x, y, n === 1 ? 16 : 12, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  FACE_TEX.set(k, t);
  return t;
}
// Box face order: +x, -x, +y, -y, +z, -z  → values 3,4,1,6,2,5 (opposites sum to 7)
const FACES = [3, 4, 1, 6, 2, 5];
function upRotation(v: number): THREE.Quaternion {
  const q = new THREE.Quaternion();
  const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
  switch (v) {
    case 1: break;
    case 6: q.setFromAxisAngle(X, Math.PI); break;
    case 2: q.setFromAxisAngle(X, -Math.PI / 2); break;
    case 5: q.setFromAxisAngle(X, Math.PI / 2); break;
    case 3: q.setFromAxisAngle(Z, Math.PI / 2); break;
    case 4: q.setFromAxisAngle(Z, -Math.PI / 2); break;
  }
  return q;
}

export class DiceTray {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 2.6, 0.1, 100);
  private dice: THREE.Mesh[] = [];
  private anim: { t0: number; dur: number; items: { m: THREE.Mesh; q0: THREE.Quaternion; q1: THREE.Quaternion; p0: THREE.Vector3; p1: THREE.Vector3; spin: THREE.Vector3 }[] } | null = null;
  private raf = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera.position.set(0, 9, 5.2);
    this.camera.lookAt(0, 0, 0.3);
    this.scene.add(new THREE.HemisphereLight('#fff1e0', '#40201a', 1.4));
    const d = new THREE.DirectionalLight('#ffffff', 2.2);
    d.position.set(-3, 8, 4);
    this.scene.add(d);
  }

  private mats(att: boolean) {
    const bg = att ? '#a3161a' : '#efe6d2';
    const pip = att ? '#fff4e6' : '#1b1b1b';
    return FACES.map((n) => new THREE.MeshStandardMaterial({ map: faceTex(n, bg, pip), roughness: 0.45 }));
  }

  /** Tumble and land the dice. Resolves when they settle. */
  roll(att: number[], def: number[]): Promise<void> {
    const w = this.canvas.clientWidth || 360, h = this.canvas.clientHeight || 140;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const m of this.dice) this.scene.remove(m);
    this.dice = [];
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const items: NonNullable<typeof this.anim>['items'] = [];
    const place = (vals: number[], att: boolean, x0: number) => {
      vals.forEach((v, i) => {
        const m = new THREE.Mesh(geo, this.mats(att));
        const p1 = new THREE.Vector3(x0 + (att ? -i : i) * 1.3, 0.5, (i % 2) * 0.3 - 0.1);
        const p0 = p1.clone().add(new THREE.Vector3(att ? -4 : 4, 3 + Math.random() * 2, -2 + Math.random()));
        const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.6);
        const q1 = yaw.multiply(upRotation(Math.max(1, Math.min(6, v))));
        const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
        m.position.copy(p0);
        this.scene.add(m);
        this.dice.push(m);
        items.push({ m, q0, q1, p0, p1, spin: new THREE.Vector3(Math.random() * 8 + 4, Math.random() * 8, Math.random() * 8) });
      });
    };
    place(att, true, -1.2);
    place(def, false, 1.6);
    return new Promise((res) => {
      this.anim = { t0: performance.now(), dur: 900, items };
      cancelAnimationFrame(this.raf);
      const tick = () => {
        const a = this.anim!;
        const k = Math.min(1, (performance.now() - a.t0) / a.dur);
        const e = 1 - Math.pow(1 - k, 3);
        for (const it of a.items) {
          it.m.position.lerpVectors(it.p0, it.p1, e);
          it.m.position.y = it.p1.y + Math.abs(Math.sin(e * Math.PI * 2.5)) * (1 - e) * 2.5;
          const tumble = new THREE.Quaternion().setFromEuler(new THREE.Euler(it.spin.x * (1 - e), it.spin.y * (1 - e), it.spin.z * (1 - e)));
          it.m.quaternion.copy(it.q1).multiply(tumble);
        }
        this.renderer.render(this.scene, this.camera);
        if (k < 1) this.raf = requestAnimationFrame(tick);
        else res();
      };
      tick();
    });
  }
}

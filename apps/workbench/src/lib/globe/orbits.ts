import * as THREE from 'three';
import {
  BUILTIN_TLES,
  CRAFT,
  EARTH_RADIUS_KM,
  gmst,
  parseTle,
  positionEci,
  subpoint,
  type Elements,
  type Tle,
} from '@/lib/live-orbits';
import { lonLatToVec } from './data';
import { css } from './textures';

// The five satellites that feed NASA FIRMS, flying their real orbits (public orbital elements,
// refreshed from /api/tle when it answers) and shown SPEED times faster than real time.
const SPEED = 90;
const RING_STEPS = 120;
const FOOT_STEPS = 64;
const TOKENS: Record<string, string> = {
  snpp: '--purple',
  noaa20: '--raw',
  noaa21: '--cyan',
  terra: '--amber',
  aqua: '--fire',
};

export type Orbits = {
  group: THREE.Group;
  update: (delta: number) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  dispose: () => void;
};

const toScene = ([x, y, z]: [number, number, number]): THREE.Vector3 =>
  new THREE.Vector3(x / EARTH_RADIUS_KM, z / EARTH_RADIUS_KM, -y / EARTH_RADIUS_KM);

function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.7)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function labelTexture(text: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 64;
  const context = canvas.getContext('2d')!;
  context.font = '600 30px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.textBaseline = 'middle';
  context.shadowColor = 'rgba(0,0,0,0.95)';
  context.shadowBlur = 8;
  context.fillStyle = color;
  context.fillText(text, 6, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createOrbits(): Orbits {
  const group = new THREE.Group();
  group.name = 'satellite-orbits';
  // Satellites live in an inertial frame; the Earth is drawn fixed, so this frame turns against it.
  const inertial = new THREE.Group();
  group.add(inertial);

  const glow = glowTexture();
  const elements: Record<string, Elements> = {};
  for (const craft of CRAFT) elements[craft.id] = parseTle(BUILTIN_TLES[craft.id]!);

  const disposables: { dispose: () => void }[] = [glow];
  const crafts = CRAFT.map((craft) => {
    const tint = css(TOKENS[craft.id]!) || '#ffffff';
    const color = new THREE.Color(tint);

    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, depthWrite: false, opacity: 0.95 }));
    halo.scale.setScalar(0.16);

    const bodyMaterial = new THREE.MeshBasicMaterial({ color: css('--text') || '#ffffff' });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.028, 0.028), bodyMaterial);
    const panelGeometry = new THREE.BoxGeometry(0.11, 0.005, 0.03);
    body.add(new THREE.Mesh(panelGeometry, bodyMaterial));
    body.name = 'satellite';

    const ringGeometry = new THREE.BufferGeometry().setFromPoints(Array.from({ length: RING_STEPS + 1 }, () => new THREE.Vector3()));
    const ringMaterial = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 });
    const ring = new THREE.Line(ringGeometry, ringMaterial);
    ring.frustumCulled = false;

    // The strip of ground the instrument sees, on the Earth's surface under the satellite.
    const footGeometry = new THREE.BufferGeometry().setFromPoints(Array.from({ length: FOOT_STEPS + 1 }, () => new THREE.Vector3()));
    const footMaterial = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
    const foot = new THREE.Line(footGeometry, footMaterial);
    foot.frustumCulled = false;

    // A thin beam from the satellite down to the point it is looking at.
    const beamGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const beamMaterial = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 });
    const beam = new THREE.Line(beamGeometry, beamMaterial);
    beam.frustumCulled = false;

    const labelMap = labelTexture(craft.label, tint);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelMap, transparent: true, depthWrite: false }));
    label.scale.set(0.5, 0.1, 1);
    label.center.set(-0.02, 0.5);

    inertial.add(ring, body, halo, label);
    group.add(foot, beam);
    disposables.push(ringGeometry, footGeometry, beamGeometry, panelGeometry, body.geometry, bodyMaterial, ringMaterial, footMaterial, beamMaterial, halo.material, label.material, labelMap);
    return { craft, body, halo, label, ringGeometry, footGeometry, beamGeometry, ringMaterial };
  });

  // Fresh orbital elements when the server has them; the built-in ones carry on otherwise.
  let stopped = false;
  fetch('/api/tle')
    .then((response) => (response.ok ? (response.json() as Promise<{ tles: Record<string, Tle> }>) : null))
    .then((body) => {
      if (!body || stopped) return;
      for (const craft of CRAFT) {
        try {
          if (body.tles[craft.id]) elements[craft.id] = parseTle(body.tles[craft.id]!);
        } catch {
          /* keep the built-in elements */
        }
      }
    })
    .catch(() => undefined);

  let simMs = Date.now();
  let sinceRings = 99;
  let ringTurn = 0;

  function update(delta: number) {
    simMs += delta * 1000 * SPEED;
    inertial.rotation.y = -gmst(simMs);
    inertial.updateMatrix();
    // The orbit rings barely change: redraw one satellite's ring per step, not all five at once.
    sinceRings += delta;
    const rebuildOne = sinceRings > 1;
    if (rebuildOne) {
      sinceRings = 0;
      ringTurn = (ringTurn + 1) % crafts.length;
    }

    for (const [index, { craft, body, halo, label, ringGeometry, footGeometry, beamGeometry }] of crafts.entries()) {
      const el = elements[craft.id]!;
      const position = toScene(positionEci(el, simMs));
      body.position.copy(position);
      halo.position.copy(position);
      label.position.copy(position);
      body.lookAt(0, 0, 0);

      // Beam and footprint, in the Earth-fixed frame.
      const sp = subpoint(el, simMs);
      const [phi, lam, rho] = [(sp.lat * Math.PI) / 180, (sp.lon * Math.PI) / 180, craft.swathKm / 2 / EARTH_RADIUS_KM];
      const foot = footGeometry.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k <= FOOT_STEPS; k += 1) {
        const bearing = (k / FOOT_STEPS) * Math.PI * 2;
        const lat2 = Math.asin(Math.sin(phi) * Math.cos(rho) + Math.cos(phi) * Math.sin(rho) * Math.cos(bearing));
        const lon2 = lam + Math.atan2(Math.sin(bearing) * Math.sin(rho) * Math.cos(phi), Math.cos(rho) - Math.sin(phi) * Math.sin(lat2));
        const v = lonLatToVec((lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI, 1.006);
        foot.setXYZ(k, v[0], v[1], v[2]);
      }
      foot.needsUpdate = true;
      const ground = lonLatToVec(sp.lon, sp.lat, 1.004);
      const beam = beamGeometry.getAttribute('position') as THREE.BufferAttribute;
      const top = position.clone().applyMatrix4(inertial.matrix); // inertial -> Earth-fixed
      beam.setXYZ(0, top.x, top.y, top.z);
      beam.setXYZ(1, ground[0], ground[1], ground[2]);
      beam.needsUpdate = true;

      if (rebuildOne && index === ringTurn) {
        const period = ((Math.PI * 2) / el.n) * 1000;
        const ring = ringGeometry.getAttribute('position') as THREE.BufferAttribute;
        for (let k = 0; k <= RING_STEPS; k += 1) {
          const q = toScene(positionEci(el, simMs + (k / RING_STEPS - 0.5) * period));
          ring.setXYZ(k, q.x, q.y, q.z);
        }
        ring.needsUpdate = true;
      }
    }
  }
  update(0);

  return {
    group,
    update,
    setTheme(theme) {
      for (const { ringMaterial } of crafts) ringMaterial.opacity = theme === 'dark' ? 0.55 : 0.8;
    },
    dispose() {
      stopped = true;
      for (const item of disposables) item.dispose();
    },
  };
}

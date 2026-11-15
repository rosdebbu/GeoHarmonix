'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { lonLatToVec } from '@/lib/globe/data';
import { createEarth } from '@/lib/globe/earth';
import { css, loadEarthPhoto } from '@/lib/globe/textures';
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
import { REGION_DEFS } from '@/lib/workbench/regions';
import type { RegionId } from '@/lib/calendar/types';

/** One NASA detection, as the globe needs it. `points` must be sorted by `ms`, oldest first. */
export type GlobePoint = {
  lat: number;
  lon: number;
  ms: number;
  sensor: string;
  /** Fill colour for the satellite map; when absent the dot is coloured by age. */
  color?: string;
  /** Draw as an empty ring (a detection that was excluded) instead of a filled dot. */
  ring?: boolean;
};

type Props = {
  region: RegionId;
  points: GlobePoint[];
  /** Detections with from <= ms <= to are drawn. */
  from: number;
  to: number;
  /** How much faster than real time the satellites fly. */
  speed: number;
  hiddenSensors: ReadonlySet<string>;
  /** `at` is the pointer position inside the globe box, for placing a tooltip. */
  onHover: (index: number | null, at?: { x: number; y: number }) => void;
  /** Drawn on top of the globe (the data cards). */
  children?: ReactNode;
};

const TINT_VAR: Record<string, string> = {
  noaa21: '--cyan',
  noaa20: '--raw',
  snpp: '--purple',
  modis: '--amber',
};
const RING_STEPS = 120;
const FOOT_STEPS = 72;
const SCENE_RADIUS = 1; // Earth radius in scene units
const toScene = ([x, y, z]: [number, number, number]): [number, number, number] => [
  (x / EARTH_RADIUS_KM) * SCENE_RADIUS,
  (z / EARTH_RADIUS_KM) * SCENE_RADIUS,
  (-y / EARTH_RADIUS_KM) * SCENE_RADIUS,
];

function dotTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d')!;
  const glow = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.35, 'rgba(255,255,255,0.9)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/** First index whose ms is >= target. */
function lowerBound(times: Float64Array, target: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** A 3D Earth with the five FIRMS satellites flying their real orbits and NASA's detections on the ground. */
export function LiveGlobe({ region, points, from, to, speed, hiddenSensors, onHover, children }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const labels = useRef<(HTMLDivElement | null)[]>([]);
  const readout = useRef<(HTMLDivElement | null)[]>([]);
  const [failed, setFailed] = useState(false);
  // Everything the render loop reads lives in refs, so props never restart the scene.
  const live = useRef({ speed, from, to, hidden: hiddenSensors, onHover });
  live.current = { speed, from, to, hidden: hiddenSensors, onHover };
  const api = useRef<{ setPoints: (points: GlobePoint[]) => void; refresh: () => void } | null>(null);

  useEffect(() => {
    const element = canvas.current;
    const box = wrap.current;
    if (!element || !box) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: element, antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 200);
    const anchor = REGION_DEFS[region].anchor;
    camera.position.set(...lonLatToVec(anchor[0], anchor[1] - 6, 3.25));
    const controls = new OrbitControls(camera, element);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.5;
    controls.minDistance = 1.5;
    controls.maxDistance = 9;

    const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const earth = createEarth('dark', anisotropy);
    scene.add(earth.group);
    const photo = loadEarthPhoto(anisotropy, (texture) => earth.applySurface('dark', texture), () => undefined);

    // Stars
    const starGeometry = new THREE.BufferGeometry();
    const stars = new Float32Array(1500 * 3);
    for (let i = 0; i < 1500; i += 1) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(40 + Math.random() * 20);
      stars.set([v.x, v.y, v.z], i * 3);
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(stars, 3));
    const starMaterial = new THREE.PointsMaterial({ color: css('--text-subtle'), size: 0.12, transparent: true, opacity: 0.7, depthWrite: false });
    scene.add(new THREE.Points(starGeometry, starMaterial));

    const dot = dotTexture();

    // Detections: earth-fixed points, a contiguous time slice of one sorted buffer.
    let times = new Float64Array(0);
    const fireGeometry = new THREE.BufferGeometry();
    const fireMaterial = new THREE.PointsMaterial({
      size: 0.042,
      sizeAttenuation: true,
      vertexColors: true,
      map: dot,
      alphaTest: 0.2,
      transparent: true,
      depthWrite: false,
    });
    const fire = new THREE.Points(fireGeometry, fireMaterial);
    fire.frustumCulled = false;
    scene.add(fire);
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 0.012 };

    const colorOf: Record<string, THREE.Color> = {};
    for (const [sensor, variable] of Object.entries(TINT_VAR)) {
      colorOf[sensor] = new THREE.Color(css(variable) || '#ffffff');
    }

    function setPoints(list: GlobePoint[]) {
      const position = new Float32Array(list.length * 3);
      const color = new Float32Array(list.length * 3);
      times = new Float64Array(list.length);
      list.forEach((p, i) => {
        position.set(lonLatToVec(p.lon, p.lat, 1.006), i * 3);
        const c = colorOf[p.sensor] ?? colorOf.modis!;
        color.set([c.r, c.g, c.b], i * 3);
        times[i] = p.ms;
      });
      fireGeometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
      fireGeometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
      fireGeometry.computeBoundingSphere();
      refresh();
    }
    function refresh() {
      const lo = lowerBound(times, live.current.from);
      const hi = lowerBound(times, live.current.to + 1);
      fireGeometry.setDrawRange(lo, Math.max(0, hi - lo));
    }
    api.current = { setPoints, refresh };

    // Satellites live in an inertial frame that turns against the fixed Earth.
    const inertial = new THREE.Group();
    scene.add(inertial);
    const elements: Record<string, Elements> = {};
    for (const craft of CRAFT) elements[craft.id] = parseTle(BUILTIN_TLES[craft.id]!);
    const crafts = CRAFT.map((craft) => {
      const color = colorOf[craft.sensor]!;
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: dot, color, transparent: true, depthWrite: false, opacity: 0.9 }),
      );
      halo.scale.setScalar(0.09);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), new THREE.MeshBasicMaterial({ color: css('--text') }));
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.004, 0.018), new THREE.MeshBasicMaterial({ color: css('--text') }));
      body.add(panel);
      const ringGeometry = new THREE.BufferGeometry().setFromPoints(Array.from({ length: RING_STEPS + 1 }, () => new THREE.Vector3()));
      const ring = new THREE.Line(ringGeometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 }));
      ring.frustumCulled = false;
      inertial.add(ring, body, halo);
      // The strip of ground the instrument sees right now, drawn on the surface under the satellite.
      const footGeometry = new THREE.BufferGeometry().setFromPoints(Array.from({ length: FOOT_STEPS + 1 }, () => new THREE.Vector3()));
      const foot = new THREE.Line(footGeometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
      foot.frustumCulled = false;
      scene.add(foot);
      return { craft, body, halo, ring, ringGeometry, foot, footGeometry };
    });

    // Fresh orbital elements, when CelesTrak answers; the built-in ones carry on otherwise.
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

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = box;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(box);

    let simMs = Date.now();
    let last = performance.now();
    let lastRing = 0;
    let lastReadout = 0;
    const tmp = new THREE.Vector3();
    let raf = 0;

    const frame = (time: number) => {
      raf = requestAnimationFrame(frame);
      const delta = Math.min(0.1, (time - last) / 1000);
      last = time;
      simMs += delta * 1000 * live.current.speed;
      inertial.rotation.y = -gmst(simMs);
      inertial.updateMatrixWorld();
      const rebuildRings = time - lastRing > 1000;
      if (rebuildRings) lastRing = time;
      const showReadout = time - lastReadout > 500;
      if (showReadout) lastReadout = time;

      crafts.forEach(({ craft, body, halo, ring, ringGeometry, foot, footGeometry }, i) => {
        const el = elements[craft.id]!;
        const visible = !live.current.hidden.has(craft.sensor);
        body.visible = halo.visible = ring.visible = foot.visible = visible;
        if (visible) {
          const sp = subpoint(el, simMs);
          const [phi, lam, rho] = [(sp.lat * Math.PI) / 180, (sp.lon * Math.PI) / 180, craft.swathKm / 2 / EARTH_RADIUS_KM];
          const attr = footGeometry.getAttribute('position') as THREE.BufferAttribute;
          for (let k = 0; k <= FOOT_STEPS; k += 1) {
            const bearing = (k / FOOT_STEPS) * Math.PI * 2;
            const lat2 = Math.asin(Math.sin(phi) * Math.cos(rho) + Math.cos(phi) * Math.sin(rho) * Math.cos(bearing));
            const lon2 = lam + Math.atan2(Math.sin(bearing) * Math.sin(rho) * Math.cos(phi), Math.cos(rho) - Math.sin(phi) * Math.sin(lat2));
            const v = lonLatToVec((lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI, 1.008);
            attr.setXYZ(k, v[0], v[1], v[2]);
          }
          attr.needsUpdate = true;
        }
        const p = toScene(positionEci(el, simMs));
        body.position.set(...p);
        halo.position.set(...p);
        body.lookAt(0, 0, 0);
        if (rebuildRings && visible) {
          const period = ((Math.PI * 2) / el.n) * 1000;
          const attr = ringGeometry.getAttribute('position') as THREE.BufferAttribute;
          for (let k = 0; k <= RING_STEPS; k += 1) {
            const q = toScene(positionEci(el, simMs + (k / RING_STEPS - 0.5) * period));
            attr.setXYZ(k, q[0], q[1], q[2]);
          }
          attr.needsUpdate = true;
        }
        // Label: follows the satellite on screen and hides behind the Earth.
        const tag = labels.current[i];
        if (tag) {
          tmp.copy(body.position).applyMatrix4(inertial.matrixWorld);
          // Hidden when the Earth is between the camera and the satellite (ray-sphere test).
          const ray = tmp.clone().sub(camera.position);
          const distance = ray.length();
          ray.normalize();
          const b = camera.position.dot(ray);
          const disc = b * b - (camera.position.lengthSq() - SCENE_RADIUS ** 2);
          const hitAt = disc > 0 ? -b - Math.sqrt(disc) : Infinity;
          const behind = hitAt > 0 && hitAt < distance;
          const screen = tmp.clone().project(camera);
          tag.style.opacity = visible && !behind ? '1' : '0';
          tag.style.transform = `translate(${((screen.x + 1) / 2) * box.clientWidth + 8}px, ${((1 - screen.y) / 2) * box.clientHeight - 8}px)`;
        }
        const line = readout.current[i];
        if (line && showReadout) {
          const s = subpoint(el, simMs);
          line.textContent = `${craft.label} · ${Math.abs(s.lat).toFixed(1)}°${s.lat >= 0 ? 'N' : 'S'} ${Math.abs(s.lon).toFixed(1)}°${s.lon >= 0 ? 'E' : 'W'} · ${s.altKm.toFixed(0)} km`;
          line.style.opacity = visible ? '1' : '0.35';
        }
      });
      refresh();
      controls.update();
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);

    let pending = false;
    const onMove = (event: PointerEvent) => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        const rect = element.getBoundingClientRect();
        raycaster.setFromCamera(
          new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1),
          camera,
        );
        const hit = raycaster.intersectObject(fire)[0];
        const range = fireGeometry.drawRange;
        const ok = hit && hit.index !== undefined && hit.index >= range.start && hit.index < range.start + range.count;
        live.current.onHover(ok ? hit.index! : null, { x: event.clientX - rect.left, y: event.clientY - rect.top });
      });
    };
    const onLeave = () => live.current.onHover(null);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerleave', onLeave);

    return () => {
      stopped = true;
      api.current = null;
      cancelAnimationFrame(raf);
      observer.disconnect();
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerleave', onLeave);
      controls.dispose();
      earth.dispose();
      photo.dispose();
      dot.dispose();
      starGeometry.dispose();
      starMaterial.dispose();
      fireGeometry.dispose();
      fireMaterial.dispose();
      for (const c of crafts) {
        c.ringGeometry.dispose();
        c.footGeometry.dispose();
        c.body.geometry.dispose();
        c.halo.material.dispose();
      }
      renderer.dispose();
    };
  }, [region]);

  useEffect(() => {
    api.current?.setPoints(points);
  }, [points, region]);

  return (
    <div ref={wrap} className="fc-live-view border-line bg-canvas relative w-full overflow-hidden rounded-md border">
      <canvas ref={canvas} className="size-full cursor-grab touch-none active:cursor-grabbing" />
      {failed && (
        <p className="text-micro text-ink-muted absolute inset-0 grid place-items-center p-4 text-center">
          This browser could not start 3D graphics. Use the Map view instead.
        </p>
      )}
      {CRAFT.map((craft, i) => (
        <div
          key={craft.id}
          ref={(node) => {
            labels.current[i] = node;
          }}
          className="text-micro text-ink pointer-events-none absolute top-0 left-0 font-mono whitespace-nowrap"
          style={{ textShadow: '0 0 4px var(--bg), 0 0 2px var(--bg)' }}
        >
          {craft.label}
        </div>
      ))}
      <div className="text-micro bg-panel/90 text-ink border-line pointer-events-none absolute top-2 left-2 flex flex-col gap-0.5 rounded-md border px-2 py-1.5 font-mono">
        {CRAFT.map((craft, i) => (
          <div
            key={craft.id}
            ref={(node) => {
              readout.current[i] = node;
            }}
          >
            {craft.label}
          </div>
        ))}
      </div>
      {children}
    </div>
  );
}

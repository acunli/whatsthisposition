"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Theme } from "@/lib/theme";
import { REVEALED_EVENT } from "../PageVeil";

/**
 * The home page's knight: the logo come to life. A sculpted marble knight rises through
 * an orange lens ring on a faint board, the ring's crosshair ticks snap in and a scan line
 * sweeps up the piece, as in the logo animation. Then it turns towards the mouse, and can
 * be spun by dragging. White marble on the dark page, black on the light one.
 *
 * The knight is from the "Chess Set" model by Riley Queen on Poly Haven (CC0), baked into
 * public/models/knight/ by scripts/bake-knight.py: about 43 KB of geometry and 60 KB of
 * textures per colour.
 */

const BRAND = "#ff7629";
const RED = "#ff4b3e";
const SKY = "#36c5f0";
/** The knight's resting angle: three-quarters, looking left like the logo's knight. */
const REST = -1;
/** Its height in board units (one square = 1), as baked. */
const HEIGHT = 1.45;
const RING_R = 0.62;
const MODEL = "/models/knight";

// ── The model ──
/** Reads knight.bin: a small header, then quantized positions, normals, uvs and indices. */
async function loadGeometry(): Promise<THREE.BufferGeometry> {
  const buf = await (await fetch(`${MODEL}/knight.bin`)).arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x4b505457) throw new Error("knight.bin: not a knight"); // "WTPK"
  const n = dv.getUint32(8, true);
  const m = dv.getUint32(12, true);
  const lo = [0, 1, 2].map((k) => dv.getFloat32(16 + k * 4, true));
  const size = [0, 1, 2].map((k) => dv.getFloat32(28 + k * 4, true));
  let off = 40;
  const qp = new Uint16Array(buf, off, n * 3);
  off += n * 6;
  const qn = new Int16Array(buf, off, n * 3);
  off += n * 6;
  const qu = new Uint16Array(buf, off, n * 2);
  off += n * 4;
  const index = new Uint16Array(buf, off, m);
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n * 3; i++) {
    pos[i] = lo[i % 3] + (qp[i] / 65535) * size[i % 3];
    nor[i] = qn[i] / 32767;
  }
  for (let i = 0; i < n * 2; i++) uv[i] = qu[i] / 65535;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}

interface Marble {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  /** Ambient occlusion, roughness and metalness in one texture (R, G, B). */
  arm: THREE.Texture;
}

/** The marble textures for a theme, fetched once each (switching back and forth is free). */
const marbles = new Map<Theme, Promise<Marble>>();
function loadMarble(theme: Theme): Promise<Marble> {
  let p = marbles.get(theme);
  if (!p) {
    const colour = theme === "dark" ? "white" : "black";
    const loader = new THREE.TextureLoader();
    const tex = (kind: string, srgb = false) =>
      loader.loadAsync(`${MODEL}/knight-${colour}-${kind}.webp`).then((t) => {
        // Laid out for glTF, whose textures aren't flipped.
        t.flipY = false;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        return t;
      });
    p = Promise.all([tex("color", true), tex("normal"), tex("arm")]).then(([map, normalMap, arm]) => ({ map, normalMap, arm }));
    marbles.set(theme, p);
  }
  return p;
}

/** A circle on the floor as a tube, so it can be drawn progressively (drawRange). */
function ringGeometry() {
  const pts = Array.from({ length: 129 }, (_, i) => {
    const a = Math.PI / 2 + (i / 128) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * RING_R, 0.004, -Math.sin(a) * RING_R);
  });
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 160, 0.016, 8, true);
}

/** Canvas-drawn textures: the faint board, the ring's glow and the knight's contact shadow. */
function boardTexture(theme: Theme) {
  const n = 1024;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d")!;
  const sq = n / 8;
  const fill = theme === "dark" ? "rgba(241, 237, 226, 0.075)" : "rgba(16, 22, 19, 0.06)";
  const grid = theme === "dark" ? "rgba(241, 237, 226, 0.07)" : "rgba(16, 22, 19, 0.08)";
  g.fillStyle = fill;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) if ((r + f) % 2 === 0) g.fillRect(f * sq, r * sq, sq, sq);
  g.strokeStyle = grid;
  g.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    g.beginPath();
    g.moveTo(i * sq, 0);
    g.lineTo(i * sq, n);
    g.moveTo(0, i * sq);
    g.lineTo(n, i * sq);
    g.stroke();
  }
  // Fade out from the knight's square to the edges.
  g.globalCompositeOperation = "destination-in";
  const fade = g.createRadialGradient(n / 2, n / 2, sq * 0.6, n / 2, n / 2, n / 2);
  fade.addColorStop(0, "rgba(0,0,0,1)");
  fade.addColorStop(0.55, "rgba(0,0,0,0.55)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = fade;
  g.fillRect(0, 0, n, n);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function radialTexture(stops: [number, string][]) {
  const n = 256;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, n, n);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const snap = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

function setupEnvironment({ gl, scene }: { gl: THREE.WebGLRenderer; scene: THREE.Scene }) {
  const pmrem = new THREE.PMREMGenerator(gl);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.32;
  gl.toneMappingExposure = 0.95;
  gl.localClippingEnabled = true;
  pmrem.dispose();
}

interface SceneProps {
  theme: Theme;
  reduced: boolean;
  onReady?: () => void;
}

function Scene({ theme, reduced, onReady }: SceneProps) {
  const { clock, size, camera, gl } = useThree();
  // Where the mouse is on the page, from -1 to 1 around the knight. Only a mouse or pen
  // steers it: a phone's last tap would leave it stuck looking one way.
  const aim = useRef({ x: 0, y: 0 });
  useEffect(() => {
    if (reduced) return;
    const on = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const r = gl.domElement.getBoundingClientRect();
      aim.current.x = Math.max(-1, Math.min(1, ((e.clientX - (r.left + r.width / 2)) / window.innerWidth) * 2));
      aim.current.y = Math.max(-1, Math.min(1, -((e.clientY - (r.top + r.height / 2)) / window.innerHeight) * 2));
    };
    window.addEventListener("pointermove", on, { passive: true });
    return () => window.removeEventListener("pointermove", on);
  }, [gl, reduced]);

  // A sideways drag spins the knight; vertical ones still scroll the page (touch-action: pan-y).
  const spin = useRef({ offset: 0, vel: 0, dragging: false });
  useEffect(() => {
    const el = gl.domElement;
    let last: { x: number; t: number; id: number } | null = null;
    const down = (e: PointerEvent) => {
      last = { x: e.clientX, t: performance.now(), id: e.pointerId };
      spin.current.dragging = true;
      spin.current.vel = 0;
    };
    const move = (e: PointerEvent) => {
      if (!last || last.id !== e.pointerId) return;
      const now = performance.now();
      const turn = (e.clientX - last.x) * 0.012;
      spin.current.offset += turn;
      spin.current.vel = turn / Math.max(0.008, (now - last.t) / 1000);
      last = { x: e.clientX, t: now, id: e.pointerId };
    };
    const up = (e: PointerEvent) => {
      if (!last || last.id !== e.pointerId) return;
      last = null;
      spin.current.dragging = false;
      spin.current.vel = Math.max(-14, Math.min(14, spin.current.vel));
    };
    const cancel = () => {
      last = null;
      spin.current.dragging = false;
      spin.current.vel = 0;
    };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
    };
  }, [gl]);
  const ringGeo = useMemo(() => ringGeometry(), []);
  // The model loads after the scene: the ring and board draw at once, the knight when it's in.
  const [geo, setGeo] = useState<THREE.BufferGeometry | null>(null);
  const [marble, setMarble] = useState<{ theme: Theme; m: Marble } | null>(null);
  useEffect(() => {
    let live = true;
    loadGeometry().then((g) => live && setGeo(g), () => undefined);
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    loadMarble(theme).then((m) => live && setMarble({ theme, m }), () => undefined);
    return () => {
      live = false;
    };
  }, [theme]);
  // The knight is clipped at the floor while it rises through it.
  const floorClip = useMemo(() => [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)], []);
  // Polished marble: the textures carry the colour, the veins, the carving and how glossy
  // each part is; a clear coat adds the polish.
  const knightMat = useMemo(
    () =>
      marble &&
      new THREE.MeshPhysicalMaterial({
        map: marble.m.map,
        normalMap: marble.m.normalMap,
        // glTF normal maps without tangents: three's derivative tangents need y flipped.
        normalScale: new THREE.Vector2(1, -1),
        roughnessMap: marble.m.arm,
        aoMap: marble.m.arm,
        roughness: 1,
        metalness: 0,
        clearcoat: marble.theme === "dark" ? 0.45 : 0.6,
        clearcoatRoughness: 0.12,
        clippingPlanes: floorClip,
      }),
    [marble, floorClip],
  );
  useEffect(() => () => knightMat?.dispose(), [knightMat]);
  const loaded = !!(geo && knightMat);

  const board = useMemo(() => boardTexture(theme), [theme]);
  const glow = useMemo(() => radialTexture([[0, "rgba(255,118,41,0.55)"], [0.45, "rgba(255,118,41,0.16)"], [1, "rgba(255,118,41,0)"]]), []);
  const shadow = useMemo(() => radialTexture([[0, "rgba(0,0,0,0.6)"], [0.5, "rgba(0,0,0,0.22)"], [1, "rgba(0,0,0,0)"]]), []);
  useEffect(() => () => board.dispose(), [board]);

  const knight = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const ticks = useRef<THREE.Group>(null);
  const dot = useRef<THREE.Mesh>(null);
  const scan = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  // The intro starts when the loading veil lifts and the model is in, so it plays in view.
  const revealedAt = useRef<number | null>(null);
  const loadedAt = useRef<number | null>(null);
  useEffect(() => {
    const on = () => {
      if (revealedAt.current === null) revealedAt.current = clock.getElapsedTime();
    };
    window.addEventListener(REVEALED_EVENT, on);
    if (!document.querySelector(".veil-boot, .veil-in")) on();
    return () => window.removeEventListener(REVEALED_EVENT, on);
  }, [clock]);

  // Frames drawn with the knight in: the third means its shaders are compiled.
  const frames = useRef(0);
  const look = useRef({ yaw: 0, pitch: 0 });
  const ringIndex = ringGeo.index!.count;
  useFrame(({ clock }, dt) => {
    const t = clock.getElapsedTime();
    if (loaded) {
      if (loadedAt.current === null) loadedAt.current = t;
      frames.current++;
      if (frames.current === 3) onReady?.();
    }
    const start = revealedAt.current === null || loadedAt.current === null ? null : Math.max(revealedAt.current, loadedAt.current);
    const since = reduced ? 99 : start === null ? 0 : t - start;

    // Intro, timed like the logo: ring draws, knight rises, ticks snap, scan sweeps, dot pops.
    const ringT = ease(since / 0.9);
    ringGeo.setDrawRange(0, Math.floor((ringIndex * ringT) / 3) * 3);
    const rise = ease((since - 0.3) / 1.15);
    const tickT = snap((since - 0.55) / 0.5);
    const dotT = snap((since - 1.4) / 0.45);
    const scanT = (since - 1.15) / 1.1;

    // The knight turns to follow the mouse.
    const k = 1 - Math.pow(0.002, dt);
    look.current.yaw += (aim.current.x * 0.75 - look.current.yaw) * k;
    look.current.pitch += (-aim.current.y * 0.12 - look.current.pitch) * k;

    // A drag spins it; after letting go it coasts, then settles back to its resting face.
    const s = spin.current;
    if (!s.dragging) {
      s.offset += s.vel * dt;
      s.vel *= Math.pow(0.04, dt);
      if (Math.abs(s.vel) < 0.4) {
        const home = Math.round(s.offset / (Math.PI * 2)) * Math.PI * 2;
        s.offset += (home - s.offset) * (1 - Math.pow(0.05, dt));
      }
    }

    const sway = reduced ? 0 : Math.sin(t * 0.33) * 0.16;
    if (knight.current) {
      knight.current.position.y = -HEIGHT * (1 - rise);
      knight.current.rotation.y = REST - 2.6 * (1 - rise) + sway + look.current.yaw + s.offset;
      knight.current.rotation.x = look.current.pitch;
    }
    if (ticks.current) {
      ticks.current.scale.setScalar(Math.max(0.0001, tickT));
      ticks.current.rotation.y = (1 - Math.min(1, tickT)) * 0.8;
    }
    if (dot.current) dot.current.scale.setScalar(Math.max(0.0001, dotT));
    if (glowRef.current) (glowRef.current.material as THREE.MeshBasicMaterial).opacity = ringT * (0.85 + (reduced ? 0 : Math.sin(t * 1.3) * 0.15));
    if (scan.current) {
      const on = scanT > 0 && scanT < 1;
      scan.current.visible = on;
      if (on) {
        scan.current.position.y = 0.02 + scanT * 1.3;
        (scan.current.material as THREE.MeshBasicMaterial).opacity = Math.sin(scanT * Math.PI) * 0.9;
      }
    }
  });

  // Narrow canvases (phones) step the camera back so the ring fits.
  const narrow = size.width < 520;
  useEffect(() => {
    camera.position.set(0, narrow ? 1.55 : 1.4, narrow ? 5.1 : 4.45);
    camera.lookAt(0, narrow ? 0.62 : 0.68, 0);
  }, [camera, narrow]);

  return (
    <>
      <hemisphereLight args={["#fff6e6", "#120e0b", theme === "dark" ? 0.22 : 0.4]} />
      <directionalLight position={[-2.8, 3.6, 3.2]} intensity={theme === "dark" ? 2.6 : 2.8} color="#fff1dc" />
      {/* The orange rim from behind: the brand's light on the piece's edge. */}
      <directionalLight position={[2.8, 1.6, -2.6]} intensity={theme === "dark" ? 7 : 4.5} color={BRAND} />
      <directionalLight position={[-3.2, 1.4, -2.2]} intensity={theme === "dark" ? 2.2 : 1.2} color={SKY} />

      <mesh rotation-x={-Math.PI / 2} position-y={0}>
        <planeGeometry args={[8, 8]} />
        <meshBasicMaterial map={board} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={glowRef} rotation-x={-Math.PI / 2} position-y={0.002}>
        <planeGeometry args={[2.3, 2.3]} />
        <meshBasicMaterial map={glow} transparent depthWrite={false} toneMapped={false} opacity={0} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.003}>
        <planeGeometry args={[1.25, 1.25]} />
        <meshBasicMaterial map={shadow} transparent depthWrite={false} opacity={theme === "dark" ? 0.9 : 0.5} />
      </mesh>

      <mesh ref={ring} geometry={ringGeo}>
        <meshBasicMaterial color={BRAND} toneMapped={false} />
      </mesh>
      <group ref={ticks}>
        {[0, 1, 2, 3].map((i) => {
          const a = (i * Math.PI) / 2;
          const r = RING_R + 0.13;
          return (
            <mesh key={i} position={[Math.sin(a) * r, 0.012, Math.cos(a) * r]} rotation-y={a}>
              <boxGeometry args={[0.032, 0.022, 0.16]} />
              <meshBasicMaterial color={BRAND} toneMapped={false} />
            </mesh>
          );
        })}
      </group>
      {/* The logo's red dot, up and to the right of the lens: out past the ring, clear of the knight. */}
      <mesh ref={dot} position={[Math.cos(Math.PI / 5) * RING_R * 1.42, 0.06, -Math.sin(Math.PI / 5) * RING_R * 1.42]}>
        <sphereGeometry args={[0.055, 24, 16]} />
        <meshBasicMaterial color={RED} toneMapped={false} />
      </mesh>
      <mesh ref={scan} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[0.44, 0.47, 64]} />
        <meshBasicMaterial color={SKY} transparent toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      <group ref={knight}>{geo && knightMat && <mesh geometry={geo} material={knightMat} />}</group>
    </>
  );
}

interface Props {
  theme: Theme;
  reduced: boolean;
  /** Stop drawing while the hero is off screen. */
  active: boolean;
  /** Called once the first frames are drawn (shaders compiled): the loading veil can lift. */
  onReady?: () => void;
}

export default function HeroKnight({ theme, reduced, active, onReady }: Props) {
  return (
    <Canvas
      className="knight-canvas"
      frameloop={active ? "always" : "never"}
      dpr={[1, 2]}
      camera={{ fov: 26, position: [0, 1.4, 4.45], near: 0.1, far: 40 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={setupEnvironment}
    >
      <Scene theme={theme} reduced={reduced} onReady={onReady} />
    </Canvas>
  );
}

"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { REVEALED_EVENT } from "../PageVeil";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { ALL_SQUARES, fileIndex, isLightSquare, rankIndex } from "@/lib/chess/board";
import type { PieceSymbol, Placement, Square } from "@/lib/chess/types";
import type { Marks, Tone } from "@/lib/facts/types";

const TONE_HEX: Record<Tone, string> = {
  danger: "#ff4b3e",
  opportunity: "#ffc53d",
  white: "#36c5f0",
  black: "#a06eff",
  idea: "#a3e635",
  info: "#f2eee4",
};

const pos = (sq: Square) => new THREE.Vector3(fileIndex(sq) - 3.5, 0, 3.5 - rankIndex(sq));

// ── Piece geometry: Staunton-like lathe profiles (radius, height), one square = 1 unit ──
const BASE: [number, number][] = [
  [0, 0],
  [0.35, 0],
  [0.36, 0.03],
  [0.35, 0.065],
  [0.31, 0.085],
  [0.31, 0.115],
  [0.27, 0.135],
];

function arc(cy: number, r: number, from: number, to: number, steps = 10): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    out.push([Math.max(0, Math.cos(a) * r), cy + Math.sin(a) * r]);
  }
  return out;
}

const PROFILES: Record<Exclude<PieceSymbol, "n">, [number, number][]> = {
  p: [...BASE, [0.2, 0.17], [0.15, 0.25], [0.12, 0.35], [0.11, 0.42], [0.18, 0.445], [0.185, 0.47], [0.12, 0.495], ...arc(0.6, 0.13, -1.1, Math.PI / 2)],
  r: [...BASE, [0.23, 0.17], [0.2, 0.3], [0.19, 0.56], [0.24, 0.6], [0.26, 0.63], [0.26, 0.78], [0.2, 0.78], [0.2, 0.72], [0, 0.72]],
  b: [...BASE, [0.21, 0.17], [0.15, 0.3], [0.115, 0.52], [0.19, 0.555], [0.19, 0.585], [0.12, 0.61], ...arc(0.8, 0.16, -1.2, 1.35, 12), ...arc(1.02, 0.045, -1.4, Math.PI / 2, 6)],
  q: [...BASE, [0.23, 0.17], [0.16, 0.33], [0.125, 0.64], [0.21, 0.68], [0.21, 0.715], [0.13, 0.745], [0.17, 0.9], [0.22, 1.0], [0.16, 1.02], [0.08, 1.07], ...arc(1.13, 0.06, -1.2, Math.PI / 2, 6)],
  k: [...BASE, [0.24, 0.17], [0.17, 0.33], [0.135, 0.68], [0.22, 0.72], [0.22, 0.755], [0.14, 0.785], [0.18, 0.96], [0.21, 1.06], [0.1, 1.11], [0, 1.11]],
};

const KNIGHT_HEAD =
  "M6.4242 293.7612H3.3096c.0424-1.2235 1.357-1.8739 1.4169-2.4641.0598-.5903-.208-.7423-.208-.7423s-.1836.7095-.4175.8545c-.234.145-.7784.2813-.7784.2813s-.382.3571-.6072.3323c-.2252-.025-.4179-.5822-.4179-.5822l.7646-1.261.3874-.894.3656-.413.1566-.6066.4401.5334c2.4231 0 2.9485 3.2354 2.0124 4.9617";

function buildGeometries() {
  const g: Partial<Record<PieceSymbol, THREE.BufferGeometry[]>> = {};
  for (const t of ["p", "r", "b", "q", "k"] as const) {
    const parts: THREE.BufferGeometry[] = [new THREE.LatheGeometry(PROFILES[t].map(([r, y]) => new THREE.Vector2(r, y)), 48)];
    if (t === "r") {
      for (let i = 0; i < 6; i++) {
        const box = new THREE.BoxGeometry(0.1, 0.09, 0.08);
        const a = (i / 6) * Math.PI * 2;
        box.translate(Math.cos(a) * 0.22, 0.82, Math.sin(a) * 0.22);
        box.rotateY(0);
        parts.push(box);
      }
    }
    if (t === "q") {
      for (let i = 0; i < 8; i++) {
        const s = new THREE.SphereGeometry(0.035, 12, 10);
        const a = (i / 8) * Math.PI * 2;
        s.translate(Math.cos(a) * 0.21, 1.02, Math.sin(a) * 0.21);
        parts.push(s);
      }
    }
    if (t === "k") {
      const v = new THREE.BoxGeometry(0.065, 0.26, 0.065);
      v.translate(0, 1.24, 0);
      const h = new THREE.BoxGeometry(0.2, 0.065, 0.065);
      h.translate(0, 1.27, 0);
      parts.push(v, h);
    }
    g[t] = parts;
  }
  // Knight: turned base + extruded head silhouette.
  const base = new THREE.LatheGeometry([...BASE, [0.24, 0.17], [0.22, 0.22], [0, 0.22]].map(([r, y]) => new THREE.Vector2(r, y)), 48);
  const data = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${KNIGHT_HEAD}"/></svg>`);
  const shapes = data.paths.flatMap((p) => p.toShapes());
  const head = new THREE.ExtrudeGeometry(shapes, { depth: 0.3 / 0.17, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 3, curveSegments: 16 });
  head.computeBoundingBox();
  const bb = head.boundingBox!;
  const cxh = (bb.min.x + bb.max.x) / 2;
  head.translate(-cxh, -bb.max.y, -(bb.min.z + bb.max.z) / 2);
  head.scale(0.17, -0.17, 0.17);
  head.translate(0, 0.2, 0);
  head.computeVertexNormals();
  g.n = [base, head];
  return g as Record<PieceSymbol, THREE.BufferGeometry[]>;
}

// ── Scene pieces ──
/** Soft studio reflections from three's procedural room (no HDR download). */
function setupEnvironment({ gl, scene }: { gl: THREE.WebGLRenderer; scene: THREE.Scene }) {
  const pmrem = new THREE.PMREMGenerator(gl);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  gl.toneMappingExposure = 0.92;
  pmrem.dispose();
}

function Board() {
  const light = useMemo(() => new THREE.MeshStandardMaterial({ color: "#cfc7b2", roughness: 0.6 }), []);
  const dark = useMemo(() => new THREE.MeshStandardMaterial({ color: "#35604b", roughness: 0.5 }), []);
  const frame = useMemo(() => new THREE.MeshStandardMaterial({ color: "#15110d", roughness: 0.35, metalness: 0.15 }), []);
  return (
    <group>
      <mesh position={[0, -0.13, 0]} material={frame} receiveShadow>
        <boxGeometry args={[9.1, 0.24, 9.1]} />
      </mesh>
      {ALL_SQUARES.map((sq) => {
        const p = pos(sq);
        return (
          <mesh key={sq} position={[p.x, -0.05, p.z]} material={isLightSquare(sq) ? light : dark} receiveShadow>
            <boxGeometry args={[1, 0.1, 1]} />
          </mesh>
        );
      })}
    </group>
  );
}

function Pieces({ placement }: { placement: Placement }) {
  const geos = useMemo(() => buildGeometries(), []);
  const white = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#ddd3bf", roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.25 }), []);
  const black = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#16181b", roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.12 }), []);
  return (
    <group>
      {ALL_SQUARES.filter((sq) => placement[sq]).map((sq) => {
        const x = placement[sq]!;
        const p = pos(sq);
        return (
          <group key={sq} position={[p.x, 0, p.z]} rotation={[0, x.type === "n" ? (x.color === "w" ? 0.45 : 0.45 + Math.PI) : 0, 0]}>
            {geos[x.type].map((geo, i) => (
              <mesh key={i} geometry={geo} material={x.color === "w" ? white : black} castShadow receiveShadow />
            ))}
          </group>
        );
      })}
    </group>
  );
}

interface Props {
  placement: Placement;
  marks: Marks | null;
  sceneKey: string;
  reduced: boolean;
  /** Stop rendering when the hero is off screen. */
  active: boolean;
  /** Lighter rendering for small screens. */
  lite: boolean;
  /** Called once the first frames are drawn (shaders compiled): the loading veil can lift. */
  onReady?: () => void;
}

/**
 * Tells the page when the scene is ready, and draws the shadows once: the board and
 * pieces never move (only the camera and the glowing overlays, which cast none), so
 * re-rendering the shadow map every frame would be wasted work.
 */
function ReadySignal({ onReady }: { onReady?: () => void }) {
  const frames = useRef(0);
  useFrame((state) => {
    frames.current++;
    if (frames.current === 2) {
      const map = state.gl.shadowMap;
      map.autoUpdate = false;
      map.needsUpdate = true;
    }
    if (frames.current === 3) onReady?.();
  });
  return null;
}

/** Glowing tiles, light pillars and arcing arrows for the current finding. */
function Overlays({ marks, sceneKey, reduced }: { marks: Marks | null; sceneKey: string; reduced: boolean }) {
  const start = useRef(0);
  const group = useRef<THREE.Group>(null);
  const { clock } = useThree();
  useEffect(() => {
    start.current = clock.getElapsedTime();
  }, [sceneKey, clock]);

  const items = useMemo(() => {
    if (!marks) return { tiles: [], pillars: [], arcs: [] };
    const tiles = marks.squares.filter((s) => ["fill", "flood", "pit", "hatch", "pulse", "ring", "dashed"].includes(s.style)).map((s, i) => ({ sq: s.sq, color: TONE_HEX[s.tone], order: s.order ?? i }));
    const pillars = marks.squares.filter((s) => s.style === "pulse" || (s.style === "ring" && s.tone !== "info")).slice(0, 4).map((s) => ({ sq: s.sq, color: TONE_HEX[s.tone] }));
    const arcs = [...marks.arrows.map((a) => ({ from: a.from, to: a.to, tone: a.tone })), ...(marks.links ?? []).map((l) => ({ from: l.from, to: l.to, tone: l.tone }))]
      .slice(0, 5)
      .map((a) => {
        const p1 = pos(a.from).setY(0.08);
        const p2 = pos(a.to).setY(0.08);
        const mid = p1.clone().lerp(p2, 0.5).setY(0.55 + p1.distanceTo(p2) * 0.18);
        const curve = new THREE.QuadraticBezierCurve3(p1, mid, p2);
        const geo = new THREE.TubeGeometry(curve, 48, 0.045, 10, false);
        return { geo, color: TONE_HEX[a.tone === "info" ? "info" : a.tone], end: p2, tangent: curve.getTangent(1) };
      });
    return { tiles, pillars, arcs };
  }, [marks]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = reduced ? 10 : clock.getElapsedTime() - start.current;
    g.traverse((o) => {
      const d = o.userData as { kind?: string; delay?: number };
      if (!d.kind) return;
      const k = Math.min(1, Math.max(0, (t - (d.delay ?? 0)) / 0.5));
      const ease = 1 - Math.pow(1 - k, 3);
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (d.kind === "tile") {
        mat.opacity = 0.62 * ease;
        mesh.scale.setScalar(0.3 + 0.7 * ease);
      } else if (d.kind === "pillar") {
        mesh.scale.y = Math.max(0.001, ease);
        mat.opacity = 0.2 * ease * (reduced ? 1 : 0.8 + 0.2 * Math.sin(t * 4));
      } else if (d.kind === "arc") {
        const geo = mesh.geometry as THREE.BufferGeometry;
        const count = geo.index ? geo.index.count : 0;
        geo.setDrawRange(0, Math.floor(count * ease));
      } else if (d.kind === "head") {
        mat.opacity = k >= 1 ? 1 : 0;
      }
    });
  });

  return (
    <group ref={group} key={sceneKey}>
      {items.tiles.map((t, i) => {
        const p = pos(t.sq);
        return (
          <mesh key={`t${i}`} position={[p.x, 0.012, p.z]} rotation={[-Math.PI / 2, 0, 0]} userData={{ kind: "tile", delay: 0.05 * t.order }}>
            <planeGeometry args={[0.96, 0.96]} />
            <meshBasicMaterial color={t.color} transparent opacity={0} depthWrite={false} />
          </mesh>
        );
      })}
      {items.pillars.map((pl, i) => {
        const p = pos(pl.sq);
        return (
          <mesh key={`p${i}`} position={[p.x, 0.9, p.z]} userData={{ kind: "pillar", delay: 0.2 }}>
            <cylinderGeometry args={[0.44, 0.44, 1.8, 40, 1, true]} />
            <meshBasicMaterial color={pl.color} transparent opacity={0} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        );
      })}
      {items.arcs.map((a, i) => (
        <group key={`a${i}`}>
          <mesh geometry={a.geo} userData={{ kind: "arc", delay: 0.15 + i * 0.12 }}>
            <meshBasicMaterial color={a.color} toneMapped={false} />
          </mesh>
          <mesh
            position={a.end}
            quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.tangent.clone().normalize())}
            userData={{ kind: "head", delay: 0.15 + i * 0.12 }}
          >
            <coneGeometry args={[0.12, 0.26, 18]} />
            <meshBasicMaterial color={a.color} toneMapped={false} transparent opacity={0} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function ScanBeam({ reduced }: { reduced: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    const k = reduced ? 2 : t / 1.8;
    ref.current.visible = k < 1.05;
    ref.current.position.z = -4.6 + 9.2 * Math.min(1, k);
  });
  return (
    <mesh ref={ref} position={[0, 0.03, -4.6]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[9.2, 0.08]} />
      <meshBasicMaterial color="#ffc53d" toneMapped={false} />
    </mesh>
  );
}

function Rig({ reduced }: { reduced: boolean }) {
  const { camera, pointer, clock } = useThree();
  // The camera's intro move starts when the loading veil lifts, so it plays in view.
  const revealedAt = useRef<number | null>(null);
  useEffect(() => {
    const on = () => {
      if (revealedAt.current === null) revealedAt.current = clock.getElapsedTime();
    };
    window.addEventListener(REVEALED_EVENT, on);
    // Already revealed (e.g. the hero mounted after the veil lifted): start now.
    if (!document.querySelector(".veil-boot, .veil-in")) on();
    return () => window.removeEventListener(REVEALED_EVENT, on);
  }, [clock]);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const sway = reduced ? 0 : Math.sin(t * 0.18) * 0.22;
    const since = revealedAt.current === null ? 0 : t - revealedAt.current;
    const intro = reduced ? 1 : Math.min(1, since / 2.4);
    const e = 1 - Math.pow(1 - intro, 3);
    const radius = 18 - 2.6 * e;
    const angle = 0.5 + sway + (reduced ? 0 : pointer.x * 0.08);
    const height = 13.5 - 2 * e + (reduced ? 0 : pointer.y * 0.5);
    camera.position.set(Math.sin(angle) * radius, height, Math.cos(angle) * radius);
    camera.lookAt(-0.6, -0.6, 0.4);
  });
  return null;
}

export default function Hero3D({ placement, marks, sceneKey, reduced, active, lite, onReady }: Props) {
  return (
    <Canvas
      shadows={lite ? false : "percentage"}
      frameloop={active ? "always" : "never"}
      dpr={lite ? 1 : [1, 1.5]}
      camera={{ fov: 30, position: [7, 9, 9], near: 0.1, far: 100 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={setupEnvironment}
    >
      <ReadySignal onReady={onReady} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[5, 11, 6]}
        intensity={1.9}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
        shadow-bias={-0.0004}
      />
      <pointLight position={[-6, 4, -6]} intensity={40} color="#ffc53d" distance={20} />
      <pointLight position={[6, 3, -7]} intensity={25} color="#36c5f0" distance={20} />
      <Board />
      <Pieces placement={placement} />
      <Overlays marks={marks} sceneKey={sceneKey} reduced={reduced} />
      <ScanBeam reduced={reduced} />
      <Rig reduced={reduced} />
    </Canvas>
  );
}

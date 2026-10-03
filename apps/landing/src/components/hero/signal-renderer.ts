/**
 * The hero's rendering boundary. A Three.js scene can replace this renderer
 * without changing the component or its scroll / pointer inputs.
 */
export interface SignalRenderer {
  resize(width: number, height: number, pixelRatio: number): void;
  setProgress(progress: number): void;
  setPointer(x: number, y: number): void;
  render(time: number): void;
  dispose(): void;
}

type Surface = {
  points: Float32Array;
  normals: Float32Array;
  projected: Float32Array;
  transformedNormals: Float32Array;
  faces: Face[];
  palette: string[];
  threads: string[];
};

type Face = {
  a: number;
  b: number;
  c: number;
  d: number;
  depth: number;
  surface: number;
  phase: number;
  thread: number;
  shade: number;
};

const TAU = Math.PI * 2;
const SHADES = 48;

function makeSurface(
  index: number,
  segments: number,
  strands: number,
): Surface {
  const points = new Float32Array((segments + 1) * (strands + 1) * 3);
  const normals = new Float32Array(points.length);
  const faces: Face[] = [];
  const radius = index === 0 ? 0.86 : 0.87;
  const tube = index === 0 ? 0.235 : 0.215;
  const center = index === 0 ? -0.43 : 0.43;

  for (let u = 0; u <= segments; u += 1) {
    const theta = (u / segments) * TAU;
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    for (let v = 0; v <= strands; v += 1) {
      const phi = (v / strands) * TAU;
      const cp = Math.cos(phi);
      const sp = Math.sin(phi);
      const p = (u * (strands + 1) + v) * 3;
      // Two orthogonal loops interlock once: their relative geometry stays
      // intact as the complete sculpture rotates.
      if (index === 0) {
        points[p] = center + (radius + tube * cp) * ct;
        points[p + 1] = (radius + tube * cp) * st;
        points[p + 2] = tube * sp;
        normals[p] = cp * ct;
        normals[p + 1] = cp * st;
        normals[p + 2] = sp;
      } else {
        points[p] = center + (radius + tube * cp) * ct;
        points[p + 1] = tube * sp;
        points[p + 2] = (radius + tube * cp) * st;
        normals[p] = cp * ct;
        normals[p + 1] = sp;
        normals[p + 2] = cp * st;
      }
      if (u < segments && v < strands) {
        const a = u * (strands + 1) + v;
        faces.push({
          a,
          b: a + strands + 1,
          c: a + strands + 2,
          d: a + 1,
          depth: 0,
          surface: index,
          phase: theta,
          thread: v,
          shade: 0,
        });
      }
    }
  }

  const palette: string[] = [];
  const threads: string[] = [];
  for (let i = 0; i < SHADES; i += 1) {
    const light = i / (SHADES - 1);
    const base = index === 0 ? [18, 38, 28] : [14, 31, 24];
    const diffuse = index === 0 ? [47, 93, 61] : [30, 66, 44];
    const filament = index === 0 ? [167, 235, 186] : [113, 185, 137];
    palette.push(
      `rgb(${base.map((channel, j) => Math.round(channel + diffuse[j]! * light)).join(",")})`,
    );
    threads.push(
      `rgb(${filament.map((channel) => Math.round(channel * (0.24 + light * 0.76))).join(",")})`,
    );
  }
  return {
    points,
    normals,
    projected: new Float32Array(points.length),
    transformedNormals: new Float32Array(points.length),
    faces,
    palette,
    threads,
  };
}

export function createSignalRenderer(
  canvas: HTMLCanvasElement,
): SignalRenderer | null {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return null;

  const compact = window.matchMedia("(max-width: 700px)").matches;
  const surfaces = [
    makeSurface(0, compact ? 56 : 64, compact ? 24 : 32),
    makeSurface(1, compact ? 56 : 64, compact ? 24 : 32),
  ];
  const faces = surfaces.flatMap((surface) => surface.faces);
  const visibleFaces: Face[] = [];
  let width = 1;
  let height = 1;
  let progress = 0;
  let pointerX = 0;
  let pointerY = 0;
  let smoothX = 0;
  let smoothY = 0;
  let disposed = false;

  return {
    resize(nextWidth, nextHeight, pixelRatio) {
      width = Math.max(1, nextWidth);
      height = Math.max(1, nextHeight);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.lineJoin = "round";
      context.lineCap = "round";
    },
    setProgress(value) {
      progress = Math.max(0, Math.min(1, value));
    },
    setPointer(x, y) {
      pointerX = Math.max(-1, Math.min(1, x));
      pointerY = Math.max(-1, Math.min(1, y));
    },
    render(time) {
      if (disposed) return;
      context.clearRect(0, 0, width, height);
      smoothX += (pointerX - smoothX) * 0.055;
      smoothY += (pointerY - smoothY) * 0.055;
      const elapsed = time * 0.001;
      // Oscillations share one period, so the idle sculpture has no reset.
      const cycle = (elapsed * TAU) / 42;
      const ax =
        -0.56 + Math.sin(cycle) * 0.13 + smoothY * 0.07 + progress * 0.28;
      const ay =
        -0.48 + Math.cos(cycle) * 0.12 + smoothX * 0.1 + progress * 0.3;
      const az = -0.36 + Math.sin(cycle) * 0.055 - progress * 0.11;
      const cx = Math.cos(ax);
      const sx = Math.sin(ax);
      const cy = Math.cos(ay);
      const sy = Math.sin(ay);
      const cz = Math.cos(az);
      const sz = Math.sin(az);
      // Reuse one matrix for every vertex and normal in the frame.
      const m00 = cy * cz; const m01 = sx * sy * cz - cx * sz; const m02 = cx * sy * cz + sx * sz;
      const m10 = cy * sz; const m11 = sx * sy * sz + cx * cz; const m12 = cx * sy * sz - sx * cz;
      const m20 = -sy; const m21 = sx * cy; const m22 = cx * cy;
      const scale =
        Math.min(width / 3.45, height / 2.9) * (1 + Math.sin(cycle) * 0.013);
      const centerX = width * 0.5;
      const centerY = height * 0.5;

      for (const surface of surfaces) {
        for (let i = 0; i < surface.points.length; i += 3) {
          const x = surface.points[i]!;
          const y = surface.points[i + 1]!;
          const z = surface.points[i + 2]!;
          const depth = x * m20 + y * m21 + z * m22;
          const perspective = 5.8 / (5.8 - depth);
          surface.projected[i] =
            centerX + (x * m00 + y * m01 + z * m02) * scale * perspective;
          surface.projected[i + 1] =
            centerY - (x * m10 + y * m11 + z * m12) * scale * perspective;
          surface.projected[i + 2] = depth;

          const nx = surface.normals[i]!;
          const ny = surface.normals[i + 1]!;
          const nz = surface.normals[i + 2]!;
          surface.transformedNormals[i] = nx * m00 + ny * m01 + nz * m02;
          surface.transformedNormals[i + 1] = nx * m10 + ny * m11 + nz * m12;
          surface.transformedNormals[i + 2] = nx * m20 + ny * m21 + nz * m22;
        }
      }

      visibleFaces.length = 0;
      for (const face of faces) {
        const surface = surfaces[face.surface]!;
        const projected = surface.projected;
        const n = surface.transformedNormals;
        const a = face.a * 3;
        const c = face.c * 3;
        const nz = (n[a + 2]! + n[c + 2]!) * 0.5;
        if (nz < -0.12) continue;
        const nx = (n[a]! + n[c]!) * 0.5;
        const ny = (n[a + 1]! + n[c + 1]!) * 0.5;
        const light = Math.max(0, Math.min(1, 0.35 + nx * -0.24 + ny * 0.34 + nz * 0.45));
        face.shade = Math.round(light * (SHADES - 1));
        face.depth = (projected[a + 2]! + projected[c + 2]!) * 0.5;
        visibleFaces.push(face);
      }
      visibleFaces.sort((a, b) => a.depth - b.depth);
      context.lineWidth = compact ? 0.55 : 0.6;

      for (const face of visibleFaces) {
        const surface = surfaces[face.surface]!;
        const p = surface.projected;
        const a = face.a * 3;
        const b = face.b * 3;
        const c = face.c * 3;
        const d = face.d * 3;
        const shade = face.shade;
        context.fillStyle = surface.palette[shade]!;
        context.beginPath();
        context.moveTo(p[a]!, p[a + 1]!);
        context.lineTo(p[b]!, p[b + 1]!);
        context.lineTo(p[c]!, p[c + 1]!);
        context.lineTo(p[d]!, p[d + 1]!);
        context.closePath();
        context.fill();
        // Seal subpixel seams between the surface facets so only the authored
        // longitudinal fibers remain visible, rather than a wireframe grid.
        context.strokeStyle = context.fillStyle;
        context.lineWidth = 0.8;
        context.stroke();

        // Thin continuous filaments carry the sculpture's material. Only a
        // handful brighten as the signal travels around each connected loop.
        let traveling = false;
        if (face.thread % 7 < 2) {
          const pulse = (elapsed * 0.46 + face.surface * 2.7 + face.thread * 0.025) % TAU;
          const distance = Math.abs(face.phase - pulse);
          traveling = Math.min(distance, TAU - distance) < 0.28;
        }
        context.strokeStyle = traveling ? "#c8f7d4" : surface.threads[shade]!;
        context.lineWidth = traveling ? 0.9 : compact ? 0.55 : 0.6;
        context.beginPath();
        context.moveTo(p[a]!, p[a + 1]!);
        context.lineTo(p[b]!, p[b + 1]!);
        context.stroke();
      }
    },
    dispose() {
      disposed = true;
      context.clearRect(0, 0, width, height);
    },
  };
}

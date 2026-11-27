// Fusion-style ViewCube in the top-right corner of the graphics area.
// It is drawn on a canvas so the face labels stay upright while the cube turns
// with the camera; clicking a visible face snaps to that standard view and the
// small house button returns to isometric.

import { h } from '../ui/dom';
import { icon } from '../ui/icons';
import { tr } from '../i18n';
import type { App } from './app';
import type { ViewName } from '../render/camera';

type Vec3 = [number, number, number];
interface Face {
  label: string;
  normal: Vec3;
  verts: Vec3[];
  view: ViewName;
}

const FACES: Face[] = [
  { label: tr("FRONT"), normal: [0, 0, 1], verts: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], view: 'front' },
  { label: tr("BACK"), normal: [0, 0, -1], verts: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]], view: 'back' },
  { label: tr("RIGHT"), normal: [1, 0, 0], verts: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]], view: 'right' },
  { label: tr("LEFT"), normal: [-1, 0, 0], verts: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]], view: 'left' },
  { label: tr("TOP"), normal: [0, 1, 0], verts: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]], view: 'top' },
  { label: tr("BOTTOM"), normal: [0, -1, 0], verts: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]], view: 'bottom' },
];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export class ViewCube {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly size = 112;
  private hover = -1;
  private hoverCorner = -1;
  private lastKey = '';
  private drag: { id: number; x: number; y: number; moved: boolean } | null = null;

  constructor(private app: App) {
    this.canvas = h('canvas', { class: 'vc-canvas', width: String(this.size), height: String(this.size), 'aria-label': tr("View cube"), role: 'img' }) as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d');
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.canvas.setPointerCapture(e.pointerId);
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      this.canvas.style.cursor = 'grabbing';
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (d && d.id === e.pointerId) {
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) > 3) d.moved = true;
        d.x = e.clientX;
        d.y = e.clientY;
        if (d.moved) {
          // Dragging the cube orbits the camera, like Fusion's ViewCube.
          this.app.renderer.camera.orbit(dx * 1.2, dy * 1.2);
          this.sync(true);
        }
        return;
      }
      this.pick(e, true);
    });
    this.canvas.addEventListener('pointerleave', () => { if (this.hover !== -1 || this.hoverCorner !== -1) { this.hover = -1; this.hoverCorner = -1; this.sync(true); } });
    const release = (e: PointerEvent) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      this.canvas.style.cursor = 'default';
      try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      // A press without dragging is a click on a face or corner.
      if (!d.moved) this.pick(e, false);
    };
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', () => { this.drag = null; this.canvas.style.cursor = 'default'; });
    const home = h('button', { class: 'vc-home', type: 'button', 'aria-label': tr("Home view"), title: tr("Home view (isometric)") }, icon('viewIso', 16));
    home.addEventListener('click', () => app.viewport.setView('isometric'));
    this.el = h('div', { class: 'view-cube', role: 'group', 'aria-label': tr("View cube") }, this.canvas, home);
    app.shell.viewport.append(this.el);
    this.sync();
  }

  /** Projects a world point to canvas pixels. */
  private project(p: Vec3): { x: number; y: number; z: number } {
    const cam = this.app.renderer.camera;
    const r = cam.right, u = cam.up, b = cam.back;
    const s = 26;
    return {
      x: this.size / 2 + dot(p, r as Vec3) * s,
      y: this.size / 2 - dot(p, u as Vec3) * s,
      z: dot(p, b as Vec3),
    };
  }

  /** The eight cube corners, in world space. */
  private static readonly CORNERS: Vec3[] = [];
  static {
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) ViewCube.CORNERS.push([x, y, z]);
  }

  /** Visible faces, nearest last (painter order). */
  private visibleFaces(): { face: Face; pts: { x: number; y: number }[]; depth: number }[] {
    const cam = this.app.renderer.camera;
    const back = cam.back as Vec3;
    const out: { face: Face; pts: { x: number; y: number }[]; depth: number }[] = [];
    for (const face of FACES) {
      if (dot(face.normal, back) <= 0.02) continue;
      const pts = face.verts.map((v) => this.project(v as Vec3));
      out.push({ face, pts: pts.map(({ x, y }) => ({ x, y })), depth: pts.reduce((a, p) => a + p.z, 0) / pts.length });
    }
    return out.sort((a, b) => a.depth - b.depth);
  }

  sync(force = false) {
    const app = this.app;
    this.el.hidden = app.inDrawing;
    if (this.el.hidden || !this.ctx) return;
    const cam = app.renderer.camera;
    const key = [...cam.right, ...cam.up, ...cam.back, cam.viewName() ?? '', String(this.hover), String(this.hoverCorner), String(!!this.drag)].join(',');
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    const ctx = this.ctx;
    const style = getComputedStyle(this.app.shell.root);
    const text = style.getPropertyValue('--text-2').trim() || '#889';
    const accentColor = () => style.getPropertyValue('--accent').trim() || '#2a7fff';
    const active = accentColor();
    ctx.clearRect(0, 0, this.size, this.size);
    const current = cam.viewName();
    const faces = this.visibleFaces();
    // The corner zones sit above the faces: small circles at each visible corner.
    const corners = ViewCube.CORNERS.map((p) => ({ p, ...this.project(p) })).filter((c) => c.z > -0.05);
    corners.forEach((c, i) => {
      const hot = this.hoverCorner === i;
      ctx.beginPath();
      ctx.arc(c.x, c.y, hot ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = hot ? 'rgba(42,127,255,0.35)' : 'rgba(120,130,140,0.10)';
      ctx.fill();
      ctx.strokeStyle = hot ? active : 'rgba(110,120,130,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    faces.forEach(({ face, pts }, index) => {
      const isActive = current === face.view;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      ctx.fillStyle = isActive ? 'rgba(42,127,255,0.30)' : this.hover === index ? 'rgba(120,160,220,0.30)' : 'rgba(130,140,150,0.20)';
      ctx.fill();
      ctx.strokeStyle = isActive ? active : 'rgba(110,120,130,0.75)';
      ctx.lineWidth = isActive ? 1.8 : 1;
      ctx.stroke();
      // Label upright at the face centre, when the face is big enough.
      const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      const area = Math.abs(pts.reduce((a, p, i) => {
        const q = pts[(i + 1) % pts.length];
        return a + p.x * q.y - q.x * p.y;
      }, 0)) / 2;
      if (area > 420) {
        ctx.fillStyle = isActive ? text : text;
        ctx.font = '600 9px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(face.label, cx, cy);
      }
    });
  }

  private pick(e: PointerEvent, hover: boolean) {
    if (!this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * this.size;
    const y = ((e.clientY - rect.top) / rect.height) * this.size;
    // Corners have priority: clicking one looks along that diagonal.
    const corners = ViewCube.CORNERS.map((p) => ({ p, ...this.project(p) })).filter((c) => c.z > -0.05);
    let cornerHit = -1;
    corners.forEach((c, i) => {
      if (Math.hypot(c.x - x, c.y - y) <= 9) cornerHit = i;
    });
    if (cornerHit >= 0) {
      if (hover) {
        this.canvas.style.cursor = 'pointer';
        if (cornerHit !== this.hoverCorner) { this.hoverCorner = cornerHit; this.hover = -1; this.sync(true); }
        return;
      }
      this.app.viewport.setOrientation(corners[cornerHit].p);
      return;
    }
    const faces = this.visibleFaces();
    let hit = -1;
    faces.forEach(({ pts }, i) => {
      let inside = false;
      for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
        const pa = pts[a], pb = pts[b];
        if ((pa.y > y) !== (pb.y > y) && x < ((pb.x - pa.x) * (y - pa.y)) / (pb.y - pa.y) + pa.x) inside = !inside;
      }
      if (inside) hit = i;
    });
    if (hover) {
      this.canvas.style.cursor = hit >= 0 ? 'pointer' : 'default';
      if (hit !== this.hover || this.hoverCorner !== -1) { this.hover = hit; this.hoverCorner = -1; this.sync(true); }
      return;
    }
    if (hit >= 0) this.app.viewport.setView(faces[hit].face.view);
  }
}

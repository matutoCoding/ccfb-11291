// WebGPU 渲染器:离屏 MSAA 场景 → 合成 → 蓝宝石表镜折射
import { SCENE_SHADER, COMPOSITE_SHADER, GLASS_SHADER } from './shaders';
import { BuiltScene, ScenePart } from './scene';
import { MovementClock, balanceAngle, palletAngle, hairspringBreath } from './sim';
import { TAU } from './train';
import {
  Mat4, mat4Perspective, mat4LookAt, mat4Multiply, mat4Translation, mat4RotZ, mat4Scale, Vec3,
} from './math';

const MAX_PARTS = 128;
const PART_STRIDE = 256; // 动态 uniform 对齐

export interface PickInfo {
  key: string;
  label: string;
  gearIndex?: number;
}

export class MovementRenderer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;
  private canvas: HTMLCanvasElement;

  private pipelineOpaque!: GPURenderPipeline;
  private pipelineTransparent!: GPURenderPipeline;
  private pipelineComposite!: GPURenderPipeline;
  private pipelineGlass!: GPURenderPipeline;

  private frameBuf: GPUBuffer;
  private partBuf: GPUBuffer;
  private glassBuf: GPUBuffer;
  private partBindGroup!: GPUBindGroup;
  private frameBindGroup!: GPUBindGroup;
  private compositeBindGroup!: GPUBindGroup;
  private glassBindGroup0!: GPUBindGroup;
  private glassBindGroup1!: GPUBindGroup;
  private sampler: GPUSampler;

  private msaaTex: GPUTexture | null = null;
  private resolveTex: GPUTexture | null = null;
  private depthTex: GPUTexture | null = null;

  private meshes = new Map<string, { vb: GPUBuffer; ib: GPUBuffer; count: number }>();
  private scene: BuiltScene | null = null;
  private partUniforms = new Float32Array((MAX_PARTS * PART_STRIDE) / 4);

  readonly clock = new MovementClock();
  msaa = 4;
  resolutionScale = 1;
  glassReflection = 0.35;

  // 相机(环绕)
  azimuth = -0.35;
  polar = 0.42;      // 与顶视的夹角
  dist = 52;
  target: Vec3 = [0, 0, 0.8];

  private raf = 0;
  private running = false;
  private destroyed = false;
  onFrame: ((simTime: number, wallTime: number) => void) | null = null;

  private constructor(canvas: HTMLCanvasElement, device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat, msaa: number, resolutionScale: number) {
    this.canvas = canvas;
    this.device = device;
    this.context = context;
    this.format = format;
    this.msaa = msaa;
    this.resolutionScale = resolutionScale;
    this.frameBuf = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.partBuf = device.createBuffer({ size: MAX_PARTS * PART_STRIDE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.glassBuf = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.buildPipelines();
  }

  static async create(canvas: HTMLCanvasElement, opts: { msaa?: number; resolutionScale?: number } = {}): Promise<MovementRenderer | null> {
    if (!navigator.gpu) return null;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!context) return null;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
    return new MovementRenderer(canvas, device, context, format, opts.msaa ?? 4, opts.resolutionScale ?? 1);
  }

  private buildPipelines(): void {
    const device = this.device;
    const sceneMod = device.createShaderModule({ code: SCENE_SHADER });
    const compMod = device.createShaderModule({ code: COMPOSITE_SHADER });
    const glassMod = device.createShaderModule({ code: GLASS_SHADER });

    const vertexBuffers: GPUVertexBufferLayout[] = [{
      arrayStride: 36,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32x3' },
      ],
    }];

    const frameBGL = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });
    const partBGL = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 128 } }],
    });
    const sceneLayout = device.createPipelineLayout({ bindGroupLayouts: [frameBGL, partBGL] });

    const depthStencil: GPUDepthStencilState = {
      format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less',
    };
    this.pipelineOpaque = device.createRenderPipeline({
      layout: sceneLayout,
      vertex: { module: sceneMod, entryPoint: 'vsMain', buffers: vertexBuffers },
      fragment: { module: sceneMod, entryPoint: 'fsMain', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil,
      multisample: { count: this.msaa },
    });
    this.pipelineTransparent = device.createRenderPipeline({
      layout: sceneLayout,
      vertex: { module: sceneMod, entryPoint: 'vsMain', buffers: vertexBuffers },
      fragment: {
        module: sceneMod, entryPoint: 'fsMain',
        targets: [{
          format: this.format,
          blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { ...depthStencil, depthWriteEnabled: false },
      multisample: { count: this.msaa },
    });

    const compBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      ],
    });
    this.pipelineComposite = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [compBGL] }),
      vertex: { module: compMod, entryPoint: 'vsMain' },
      fragment: { module: compMod, entryPoint: 'fsMain', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });

    const glassBGL0 = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      ],
    });
    const glassBGL1 = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });
    this.pipelineGlass = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [glassBGL0, glassBGL1] }),
      vertex: {
        module: glassMod, entryPoint: 'vsMain',
        buffers: [{ arrayStride: 36, attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
        ] }],
      },
      fragment: { module: glassMod, entryPoint: 'fsMain', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    });

    this.frameBindGroup = device.createBindGroup({
      layout: frameBGL,
      entries: [{ binding: 0, resource: { buffer: this.frameBuf } }],
    });
    this.partBindGroup = device.createBindGroup({
      layout: partBGL,
      entries: [{ binding: 0, resource: { buffer: this.partBuf, offset: 0, size: PART_STRIDE } }],
    });
    this.glassBindGroup1 = device.createBindGroup({
      layout: glassBGL1,
      entries: [{ binding: 0, resource: { buffer: this.glassBuf } }],
    });
    this.compBGL = compBGL;
    this.glassBGL0 = glassBGL0;
  }

  private compBGL!: GPUBindGroupLayout;
  private glassBGL0!: GPUBindGroupLayout;

  setScene(scene: BuiltScene): void {
    // 释放旧网格
    for (const m of this.meshes.values()) { m.vb.destroy(); m.ib.destroy(); }
    this.meshes.clear();
    this.scene = scene;
    for (const part of scene.parts) {
      if (this.meshes.has(part.key)) continue;
      const d = part.mesh;
      const interleaved = new Float32Array(d.positions.length * 3);
      const n = d.positions.length / 3;
      for (let i = 0; i < n; i++) {
        interleaved.set(d.positions.subarray(i * 3, i * 3 + 3), i * 9);
        interleaved.set(d.normals.subarray(i * 3, i * 3 + 3), i * 9 + 3);
        interleaved.set(d.tangents.subarray(i * 3, i * 3 + 3), i * 9 + 6);
      }
      const vb = this.device.createBuffer({ size: interleaved.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(vb, 0, interleaved);
      const ib = this.device.createBuffer({ size: d.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(ib, 0, d.indices as Uint32Array<ArrayBuffer>);
      this.meshes.set(part.key, { vb, ib, count: d.indices.length });
    }
    // 视野对准机芯中心
    this.target = [0, 0, 0.8];
    this.dist = Math.max(40, scene.plateRadius * 3.0);
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.resolutionScale;
    const w = Math.max(8, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(8, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width === w && this.canvas.height === h && this.msaaTex) return;
    this.canvas.width = w; this.canvas.height = h;
    this.msaaTex?.destroy(); this.resolveTex?.destroy(); this.depthTex?.destroy();
    const size = { width: w, height: h };
    if (this.msaa > 1) {
      this.msaaTex = this.device.createTexture({ size, format: this.format, sampleCount: this.msaa, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    }
    this.resolveTex = this.device.createTexture({ size, format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.depthTex = this.device.createTexture({ size, format: 'depth24plus', sampleCount: this.msaa, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.compositeBindGroup = this.device.createBindGroup({
      layout: this.compBGL,
      entries: [
        { binding: 0, resource: this.resolveTex.createView() },
        { binding: 1, resource: this.sampler },
      ],
    });
    this.glassBindGroup0 = this.device.createBindGroup({
      layout: this.glassBGL0,
      entries: [
        { binding: 0, resource: { buffer: this.frameBuf } },
        { binding: 1, resource: this.resolveTex.createView() },
        { binding: 2, resource: this.sampler },
      ],
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (now: number) => {
      if (!this.running || this.destroyed) return;
      this.renderFrame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose(): void {
    this.stop();
    this.destroyed = true;
    for (const m of this.meshes.values()) { m.vb.destroy(); m.ib.destroy(); }
    this.msaaTex?.destroy(); this.resolveTex?.destroy(); this.depthTex?.destroy();
    this.frameBuf.destroy(); this.partBuf.destroy(); this.glassBuf.destroy();
    this.context.unconfigure();
  }

  private cameraMatrices(): { viewProj: Mat4; eye: Vec3 } {
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const proj = mat4Perspective((32 * Math.PI) / 180, aspect, 1, 400);
    const sp = Math.sin(this.polar), cp = Math.cos(this.polar);
    const eye: Vec3 = [
      this.target[0] + this.dist * sp * Math.cos(this.azimuth),
      this.target[1] + this.dist * sp * Math.sin(this.azimuth),
      this.target[2] + this.dist * cp,
    ];
    const view = mat4LookAt(eye, this.target, [0, 1, 0]);
    return { viewProj: mat4Multiply(proj, view), eye };
  }

  private partModel(part: ScenePart, t: number): Mat4 {
    const [x, y, z] = part.pos;
    const T = mat4Translation(x, y, z);
    switch (part.kind) {
      case 'gear': {
        const w = this.scene!.omegas[part.gearIndex ?? 0] ?? 0;
        return mat4Multiply(T, mat4RotZ(w * TAU * t));
      }
      case 'balance':
        return mat4Multiply(T, mat4RotZ(balanceAngle(t, this.scene!.vph)));
      case 'hairspring': {
        const a = balanceAngle(t, this.scene!.vph);
        const s = hairspringBreath(t, this.scene!.vph);
        return mat4Multiply(T, mat4Multiply(mat4RotZ(a), mat4Scale(s)));
      }
      case 'pallet': {
        const sc = this.scene!;
        const esc = sc.movement.gears.find(g => g.type === 'escape');
        const bp = sc.movement.balancePosition;
        let base = 0;
        if (esc) base = Math.atan2(esc.y - bp.y, esc.x - bp.x) - Math.PI / 2;
        return mat4Multiply(T, mat4RotZ(base + palletAngle(t, sc.vph)));
      }
      default:
        return T;
    }
  }

  renderFrame(now: number): void {
    if (!this.scene || this.destroyed) return;
    this.clock.tick(now);
    this.resize();
    const t = this.clock.time;
    const { viewProj, eye } = this.cameraMatrices();

    // 帧 uniform
    const f = new Float32Array(32);
    f.set(viewProj, 0);
    f.set([eye[0], eye[1], eye[2], 0], 16);
    f.set([0.45, 0.55, 0.75, 1.0], 20);   // 主光
    f.set([-0.5, -0.3, 0.55, 0.45], 24);  // 补光
    f.set([t, this.glassReflection, 0, 0], 28);
    this.device.queue.writeBuffer(this.frameBuf, 0, f);

    // 零件 uniform
    const parts = this.scene.parts.slice(0, MAX_PARTS);
    parts.forEach((part, i) => {
      const o = (i * PART_STRIDE) / 4;
      this.partUniforms.set(this.partModel(part, t), o);
      const m = part.material;
      this.partUniforms.set([m.color[0], m.color[1], m.color[2], m.metallic], o + 16);
      this.partUniforms.set([m.roughness, m.anisotropy, m.finishMode, m.alpha], o + 20);
      this.partUniforms.set([m.size, m.angle, m.chamfer ? 1 : 0, 0], o + 24);
      this.partUniforms.set([0, 0, 0, 0], o + 28);
    });
    this.device.queue.writeBuffer(this.partBuf, 0, this.partUniforms, 0, (parts.length * PART_STRIDE) / 4);

    // 表镜 uniform
    const glass = new Float32Array(64);
    glass.set(mat4Translation(0, 0, 0), 0);
    glass.set([1.0, this.glassReflection, 0, 0], 16);
    this.device.queue.writeBuffer(this.glassBuf, 0, glass);

    const encoder = this.device.createCommandEncoder();

    // Pass 1: 机芯场景 → MSAA → resolve
    const colorView = this.msaaTex ? this.msaaTex.createView() : this.resolveTex!.createView();
    const pass1 = encoder.beginRenderPass({
      colorAttachments: [{
        view: colorView,
        resolveTarget: this.msaaTex ? this.resolveTex!.createView() : undefined,
        clearValue: { r: 0.055, g: 0.06, b: 0.075, a: 1 },
        loadOp: 'clear', storeOp: this.msaaTex ? 'discard' : 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTex!.createView(),
        depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard',
      },
    });
    pass1.setBindGroup(0, this.frameBindGroup);
    const drawParts = (transparent: boolean) => {
      pass1.setPipeline(transparent ? this.pipelineTransparent : this.pipelineOpaque);
      parts.forEach((part, i) => {
        if (part.kind === 'glass' || part.transparent !== transparent) return;
        const mesh = this.meshes.get(part.key);
        if (!mesh) return;
        pass1.setBindGroup(1, this.partBindGroup, [i * PART_STRIDE]);
        pass1.setVertexBuffer(0, mesh.vb);
        pass1.setIndexBuffer(mesh.ib, 'uint32');
        pass1.drawIndexed(mesh.count);
      });
    };
    drawParts(false);
    drawParts(true);
    pass1.end();

    // Pass 2: 合成到画布 + 表镜
    const pass2 = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.05, g: 0.055, b: 0.07, a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
    });
    pass2.setPipeline(this.pipelineComposite);
    pass2.setBindGroup(0, this.compositeBindGroup);
    pass2.draw(3);
    const glassPart = parts.find(p => p.kind === 'glass');
    const glassMesh = glassPart ? this.meshes.get(glassPart.key) : null;
    if (glassPart && glassMesh) {
      pass2.setPipeline(this.pipelineGlass);
      pass2.setBindGroup(0, this.glassBindGroup0);
      pass2.setBindGroup(1, this.glassBindGroup1);
      pass2.setVertexBuffer(0, glassMesh.vb);
      pass2.setIndexBuffer(glassMesh.ib, 'uint32');
      pass2.drawIndexed(glassMesh.count);
    }
    pass2.end();

    this.device.queue.submit([encoder.finish()]);
    this.onFrame?.(t, this.clock.wallTime);
  }

  /** 屏幕坐标 → 拾取(点击齿轮显示信息) */
  pick(clientX: number, clientY: number): PickInfo | null {
    if (!this.scene) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const tanH = Math.tan((32 * Math.PI) / 360);
    const { eye } = this.cameraMatrices();
    const fwd: Vec3 = [this.target[0] - eye[0], this.target[1] - eye[1], this.target[2] - eye[2]];
    const fl = Math.hypot(...fwd);
    const f: Vec3 = [fwd[0] / fl, fwd[1] / fl, fwd[2] / fl];
    const up0: Vec3 = [0, 1, 0];
    let r: Vec3 = [f[1] * up0[2] - f[2] * up0[1], f[2] * up0[0] - f[0] * up0[2], f[0] * up0[1] - f[1] * up0[0]];
    const rl = Math.hypot(...r) || 1;
    r = [r[0] / rl, r[1] / rl, r[2] / rl];
    const u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const dir: Vec3 = [
      f[0] + ndcX * tanH * aspect * r[0] + ndcY * tanH * u[0],
      f[1] + ndcX * tanH * aspect * r[1] + ndcY * tanH * u[1],
      f[2] + ndcX * tanH * aspect * r[2] + ndcY * tanH * u[2],
    ];
    const dl = Math.hypot(...dir);
    const d: Vec3 = [dir[0] / dl, dir[1] / dl, dir[2] / dl];

    let best: { part: ScenePart; t: number } | null = null;
    for (const part of this.scene.parts) {
      if (part.pickRadius <= 0) continue;
      const [cx, cy] = [part.pos[0], part.pos[1]];
      const z0 = 0, z1 = 2.6;
      // 侧面:XY 投影解二次方程
      const ox = eye[0] - cx, oy = eye[1] - cy;
      const a = d[0] * d[0] + d[1] * d[1];
      const b = 2 * (ox * d[0] + oy * d[1]);
      const c = ox * ox + oy * oy - part.pickRadius * part.pickRadius;
      const checkT = (t: number) => {
        if (t <= 0) return;
        const z = eye[2] + t * d[2];
        if (z < z0 - 0.5 || z > z1 + 0.5) return;
        if (!best || t < best.t) best = { part, t };
      };
      if (a > 1e-9) {
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
          checkT((-b - Math.sqrt(disc)) / (2 * a));
        }
      }
      // 顶面
      if (Math.abs(d[2]) > 1e-6) {
        const t = (z1 - eye[2]) / d[2];
        if (t > 0) {
          const px = eye[0] + t * d[0] - cx, py = eye[1] + t * d[1] - cy;
          if (px * px + py * py <= part.pickRadius * part.pickRadius) {
            if (!best || t < best.t) best = { part, t };
          }
        }
      }
    }
    if (!best) return null;
    const p = (best as { part: ScenePart }).part;
    return { key: p.key, label: p.label, gearIndex: p.gearIndex };
  }

  /** 截图:先渲染一帧,再同步合成到 2D 画布叠加参数文字 */
  captureWithOverlay(lines: string[]): Promise<Blob | null> {
    this.renderFrame(performance.now());
    const w = this.canvas.width, h = this.canvas.height;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(this.canvas, 0, 0, w, h);
    const pad = Math.round(h * 0.02);
    const lh = Math.round(h * 0.026);
    ctx.font = `${Math.round(h * 0.02)}px "Segoe UI", "PingFang SC", sans-serif`;
    ctx.textBaseline = 'top';
    const boxH = lh * lines.length + pad * 1.6;
    ctx.fillStyle = 'rgba(10, 12, 16, 0.72)';
    ctx.fillRect(0, h - boxH, w, boxH);
    ctx.fillStyle = '#e6e9ef';
    lines.forEach((line, i) => ctx.fillText(line, pad, h - boxH + pad * 0.8 + i * lh));
    return new Promise(resolve => out.toBlob(b => resolve(b), 'image/png'));
  }
}

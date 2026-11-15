// WGSL 着色器
//
// 防闪烁设计(对应"转动时拉丝反光不能闪"):
// - 拉丝/条纹/珍珠纹全部在【物体局部空间】计算,随零件一起旋转,
//   切线方向由几何位置解析得到,不依赖屏幕空间、不依赖逐帧随机数;
// - 高光用解析的 Kajiya-Kay 各向异性模型,无噪声贴图;
// - 粗糙度下限钳制,配合 4x MSAA,消除边缘与高光锯齿闪烁。

export const SCENE_SHADER = /* wgsl */ `
struct Frame {
  viewProj: mat4x4f,
  cameraPos: vec4f,   // xyz
  lightDir: vec4f,    // 指向光源, xyz + 强度
  light2Dir: vec4f,
  misc: vec4f,        // x: time, y: glassReflection, z,w: unused
}

struct Part {
  model: mat4x4f,
  baseColor: vec4f,   // rgb + metallic
  params0: vec4f,     // x: roughness, y: anisotropy, z: finishMode, w: alpha
  params1: vec4f,     // x: 条纹宽/珍珠纹直径, y: 角度rad, z: 倒角抛光标记, w: unused
  emissive: vec4f,
}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<uniform> part: Part;

struct VsIn {
  @location(0) pos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) tan: vec3f,
}

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) worldNrm: vec3f,
  @location(2) worldTan: vec3f,
  @location(3) localPos: vec3f,
}

@vertex
fn vsMain(in: VsIn) -> VsOut {
  var out: VsOut;
  let wp = part.model * vec4f(in.pos, 1.0);
  out.clip = frame.viewProj * wp;
  out.worldPos = wp.xyz;
  let rot = mat3x3f(part.model[0].xyz, part.model[1].xyz, part.model[2].xyz);
  out.worldNrm = rot * in.nrm;
  out.worldTan = rot * in.tan;
  out.localPos = in.pos;
  return out;
}

// 回火色:钢本色 → 稻草黄 → 紫 → 蓝(蓝钢螺丝的回火色带)
fn temperColor(t: f32) -> vec3f {
  let x = clamp(t, 0.0, 1.0);
  let c1 = vec3f(0.62, 0.63, 0.66); // 钢
  let c2 = vec3f(0.83, 0.66, 0.35); // 稻草黄
  let c3 = vec3f(0.42, 0.20, 0.55); // 紫
  let c4 = vec3f(0.08, 0.22, 0.72); // 蓝
  var col = mix(c1, c2, smoothstep(0.0, 0.35, x));
  col = mix(col, c3, smoothstep(0.35, 0.65, x));
  col = mix(col, c4, smoothstep(0.6, 0.9, x));
  return col;
}

fn kajiyaSpec(T: vec3f, H: vec3f, exponent: f32) -> f32 {
  let d = clamp(dot(T, H), -1.0, 1.0);
  let s = sqrt(max(1e-5, 1.0 - d * d));
  return pow(s, exponent);
}

fn rot2(v: vec2f, a: f32) -> vec2f {
  let c = cos(a); let s = sin(a);
  return vec2f(c * v.x - s * v.y, s * v.x + c * v.y);
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4f {
  let mode = u32(part.params0.z + 0.5);
  var rough = clamp(part.params0.x, 0.06, 1.0);
  let aniso = clamp(part.params0.y, 0.0, 1.0);
  let metallic = clamp(part.baseColor.w, 0.0, 1.0);
  var baseCol = part.baseColor.rgb;
  let size = max(part.params1.x, 0.05);
  let angle = part.params1.y;
  let chamferPolished = part.params1.z > 0.5;

  var N = normalize(in.worldNrm);
  let V = normalize(frame.cameraPos.xyz - in.worldPos);
  // 局部空间拉丝方向(随零件旋转,保证高光稳定)
  var T = normalize(in.worldTan);
  let lp = in.localPos.xy;

  if (mode == 1u) {
    // 直线拉丝
    let d = rot2(vec2f(1.0, 0.0), angle);
    T = normalize(mat3x3f(part.model[0].xyz, part.model[1].xyz, part.model[2].xyz) * vec3f(d, 0.0));
  } else if (mode == 3u) {
    // 日内瓦波纹:条纹带内拉丝方向交替偏转,带间有柔和棱线
    let dirA = rot2(vec2f(1.0, 0.0), angle);
    let perpA = vec2f(-dirA.y, dirA.x);
    let coord = dot(lp, perpA) / size;
    let band = floor(coord);
    let parity = band - 2.0 * floor(band * 0.5);
    let skew = select(-0.5, 0.5, parity > 0.5);
    let sd = rot2(dirA, skew);
    T = normalize(mat3x3f(part.model[0].xyz, part.model[1].xyz, part.model[2].xyz) * vec3f(sd, 0.0));
    let f = fract(coord);
    let edge = smoothstep(0.0, 0.10, f) * smoothstep(1.0, 0.90, f);
    rough = mix(rough * 0.7, rough * 1.4, 1.0 - edge);
  } else if (mode == 4u) {
    // 珍珠圆点纹:错位圆阵,圆内法线呈碗状扰动
    var p = rot2(lp, angle) / size;
    let row = floor(p.y);
    p.x += 0.5 * (row - 2.0 * floor(row * 0.5));
    let f = fract(p) - 0.5;
    let d = length(f);
    let bowl = (0.5 - d) * 0.9 * (1.0 - smoothstep(0.38, 0.5, d));
    let radialL = vec3f(f / max(d, 1e-4), 0.0);
    let radialW = normalize(mat3x3f(part.model[0].xyz, part.model[1].xyz, part.model[2].xyz) * radialL);
    N = normalize(N + radialW * bowl);
    let tangL = vec3f(-f.y, f.x, 0.0) / max(d, 1e-4);
    T = normalize(mat3x3f(part.model[0].xyz, part.model[1].xyz, part.model[2].xyz) * tangL);
  } else if (mode == 7u) {
    // 太阳放射纹:切线沿半径方向
    let rl = vec3f(lp / max(length(lp), 1e-4), 0.0);
    T = normalize(mat3x3f(part.model[0].xyz, part.model[1].xyz, part.model[2].xyz) * rl);
  }
  // mode 2(环形拉丝)直接用预计算的环绕切线;mode 0 镜面无需切线

  // 倒角抛光:斜面(法线 Z 分量居中)强制镜面
  if (chamferPolished && abs(N.z) > 0.25 && abs(N.z) < 0.92) {
    rough = 0.05;
  }

  // 蓝钢:按视角取回火色
  if (mode == 5u) {
    let ndv = clamp(dot(N, V), 0.0, 1.0);
    baseCol = temperColor(0.62 + (1.0 - ndv) * 0.35);
    rough = min(rough, 0.12);
  }

  let L1 = normalize(frame.lightDir.xyz);
  let L2 = normalize(frame.light2Dir.xyz);
  let l1i = frame.lightDir.w;
  let l2i = frame.light2Dir.w;

  // 环境:半球光
  let hemi = mix(vec3f(0.10, 0.10, 0.12), vec3f(0.42, 0.43, 0.47), N.z * 0.5 + 0.5);
  var col = baseCol * hemi * mix(0.25, 1.0, 1.0 - metallic * 0.4);

  let F0 = mix(vec3f(0.04, 0.04, 0.04), baseCol, metallic);
  let exponent = mix(6.0, 500.0, pow(1.0 - rough, 2.0));

  for (var li = 0; li < 2; li++) {
    let L = select(L2, L1, li == 0);
    let Li = select(l2i, l1i, li == 0);
    let ndl = clamp(dot(N, L), 0.0, 1.0);
    if (ndl > 0.0) {
      let H = normalize(L + V);
      let ndh = clamp(dot(N, H), 0.0, 1.0);
      let ndv = clamp(dot(N, V), 0.0, 1.0);
      let fres = F0 + (1.0 - F0) * pow(1.0 - ndv, 5.0);
      let specIso = pow(ndh, exponent);
      let specAniso = kajiyaSpec(T, H, exponent);
      let spec = mix(specIso, specAniso, aniso) * ndl;
      col += baseCol * ndl * Li * (1.0 - metallic) * 0.35;
      col += fres * spec * Li * 2.2;
    }
  }

  // 红宝石:透光感(背光透射 + 内部辉光)
  var alpha = part.params0.w;
  if (mode == 6u) {
    let back = pow(clamp(dot(-V, L1), 0.0, 1.0), 2.0);
    col = mix(vec3f(0.30, 0.008, 0.02), vec3f(0.95, 0.10, 0.14), back * 0.85 + 0.12);
    col += vec3f(1.0, 0.9, 0.9) * pow(clamp(dot(N, normalize(L1 + V)), 0.0, 1.0), 300.0) * 1.5;
  }

  col += part.emissive.rgb;
  return vec4f(col, alpha);
}
`;

export const COMPOSITE_SHADER = /* wgsl */ `
@group(0) @binding(0) var sceneTex: texture_2d<f32>;
@group(0) @binding(1) var sceneSamp: sampler;

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vsMain(@builtin(vertex_index) vi: u32) -> VsOut {
  var out: VsOut;
  let p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  out.clip = vec4f(p[vi], 0.0, 1.0);
  out.uv = p[vi] * vec2f(0.5, -0.5) + 0.5;
  return out;
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4f {
  return textureSample(sceneTex, sceneSamp, in.uv);
}
`;

// 蓝宝石后盖:薄壳折射(采样场景纹理偏移) + 菲涅尔轻微反光
export const GLASS_SHADER = /* wgsl */ `
struct Frame {
  viewProj: mat4x4f,
  cameraPos: vec4f,
  lightDir: vec4f,
  light2Dir: vec4f,
  misc: vec4f,        // x: time, y: glassReflection
}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var sceneTex: texture_2d<f32>;
@group(0) @binding(2) var sceneSamp: sampler;
@group(1) @binding(0) var<uniform> part: GlassPart;

struct GlassPart {
  model: mat4x4f,
  params: vec4f,      // x: 折射强度, y: 反光强度, z,w: unused
}

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) nrm: vec3f,
}

@vertex
fn vsMain(@location(0) pos: vec3f, @location(1) nrm: vec3f) -> VsOut {
  var out: VsOut;
  let wp = part.model * vec4f(pos, 1.0);
  out.clip = frame.viewProj * wp;
  out.worldPos = wp.xyz;
  out.nrm = mat3x3f(part.model[0].xyz, part.model[1].xyz, part.model[2].xyz) * nrm;
  return out;
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4f {
  var uv = in.clip.xy * vec2f(0.5, -0.5) / in.clip.w + 0.5;
  let V = normalize(frame.cameraPos.xyz - in.worldPos);
  let N = normalize(in.nrm);
  // 薄壳折射:按法线倾斜偏移采样(蓝宝石 n≈1.76)
  uv += N.xy * part.params.x * 0.012;
  let scene = textureSample(sceneTex, sceneSamp, uv).rgb;
  let fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
  let R = reflect(-V, N);
  let env = mix(vec3f(0.04, 0.045, 0.06), vec3f(0.55, 0.58, 0.65), clamp(R.z * 0.5 + 0.5, 0.0, 1.0));
  let k = (0.03 + 0.6 * fres) * part.params.y;
  let col = mix(scene * vec3f(0.985, 0.995, 1.0), env, clamp(k, 0.0, 1.0));
  return vec4f(col, 1.0);
}
`;

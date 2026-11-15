// 开发期 WGSL 验证:在浏览器里用 wgsl_reflect 解析三个着色器
// 用法:浏览器控制台 await (await import('/src/dev/wgslCheck.ts')).validateWgsl()
import { WgslReflect } from 'wgsl_reflect';
import { SCENE_SHADER, COMPOSITE_SHADER, GLASS_SHADER } from '../shaders';

export function validateWgsl(): string[] {
  const shaders: [string, string][] = [
    ['SCENE', SCENE_SHADER],
    ['COMPOSITE', COMPOSITE_SHADER],
    ['GLASS', GLASS_SHADER],
  ];
  const out: string[] = [];
  for (const [name, code] of shaders) {
    try {
      const r = new WgslReflect(code);
      out.push(`${name}: OK (vertex=${r.entry.vertex.length}, fragment=${r.entry.fragment.length}, uniforms=${r.uniforms.length})`);
    } catch (e) {
      out.push(`${name}: FAIL ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

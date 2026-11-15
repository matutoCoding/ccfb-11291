// DOM 小工具
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v as unknown as EventListener);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}

export function fieldRow(label: string, control: HTMLElement): HTMLElement {
  const l = el('label', { class: 'field' });
  l.append(el('span', {}, [label]), control);
  return l;
}

export function numberInput(value: number, onChange: (v: number) => void, opts: { min?: number; max?: number; step?: number } = {}): HTMLInputElement {
  const input = el('input', { type: 'number', value: String(value) }) as HTMLInputElement;
  if (opts.min !== undefined) input.min = String(opts.min);
  if (opts.max !== undefined) input.max = String(opts.max);
  if (opts.step !== undefined) input.step = String(opts.step);
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) onChange(v);
    else input.value = String(value);
  });
  return input;
}

export function selectInput<T extends string>(value: T, options: { value: T; label: string }[], onChange: (v: T) => void): HTMLSelectElement {
  const sel = el('select') as HTMLSelectElement;
  for (const o of options) {
    const opt = el('option', { value: o.value }, [o.label]) as HTMLOptionElement;
    if (o.value === value) opt.selected = true;
    sel.append(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value as T));
  return sel;
}

export function rangeInput(value: number, min: number, max: number, step: number, onChange: (v: number) => void): HTMLInputElement {
  const input = el('input', { type: 'range', value: String(value) }) as HTMLInputElement;
  input.min = String(min); input.max = String(max); input.step = String(step);
  input.addEventListener('input', () => onChange(parseFloat(input.value)));
  return input;
}

export function checkboxInput(value: boolean, onChange: (v: boolean) => void): HTMLInputElement {
  const input = el('input', { type: 'checkbox' }) as HTMLInputElement;
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  return input;
}

export function textInput(value: string, onChange: (v: string) => void, placeholder = ''): HTMLInputElement {
  const input = el('input', { type: 'text', value, placeholder }) as HTMLInputElement;
  input.addEventListener('change', () => onChange(input.value));
  return input;
}

/**
 * A tiny, dependency-free virtual DOM with function components and hooks.
 *
 * The API intentionally mirrors a subset of Preact (`h`, `Fragment`, `render`,
 * `useState`, `useEffect`, `useMemo`, `useRef`, …) so the app can move to Preact
 * by swapping this import once package installs are available.
 *
 * Rendering model: any state change schedules one re-render of the whole tree
 * (batched in a microtask). Components are matched by position/key and type, so
 * hook state survives re-renders. For an app of this size a full re-render is
 * well under a few milliseconds.
 */

export type Key = string | number | null | undefined;
export type Child = VNode | string | number | boolean | null | undefined | Child[];
export type ComponentType<P = any> = (props: P) => Child;

export interface VNode {
  type: string | ComponentType | typeof TEXT;
  props: Record<string, any>;
  key: Key;
  /** DOM node produced by this vnode (for components: the root node of their output). */
  _dom: Node | null;
  /** Elements: normalised children. Components: [rendered output]. */
  _kids: VNode[] | null;
  /** Hook state of a component instance. */
  _hooks?: any[];
}

const TEXT = '#text';
const SVG_NS = 'http://www.w3.org/2000/svg';

export function Fragment(props: { children?: Child }): Child {
  return props.children;
}

export function h(type: VNode['type'], props: Record<string, any> | null, ...children: Child[]): VNode {
  const p: Record<string, any> = {};
  let key: Key;
  if (props) {
    for (const k in props) {
      if (k === 'key') key = props[k];
      else p[k] = props[k];
    }
  }
  if (children.length) p.children = children.length === 1 ? children[0] : children;
  return { type, props: p, key, _dom: null, _kids: null };
}

function textVNode(text: string): VNode {
  return { type: TEXT, props: { nodeValue: text }, key: undefined, _dom: null, _kids: null };
}

/** Flattens arrays and fragments, drops empty values and wraps primitives. */
function normalize(children: Child, out: VNode[] = []): VNode[] {
  if (children == null || typeof children === 'boolean') return out;
  if (Array.isArray(children)) {
    for (const c of children) normalize(c, out);
  } else if (typeof children === 'object') {
    if (children.type === Fragment) normalize(children.props.children, out);
    else out.push(children);
  } else {
    out.push(textVNode(String(children)));
  }
  return out;
}

/** A component's output must be a single node; wrap lists/fragments, use an empty text node for null. */
function normalizeRoot(out: Child): VNode {
  const list = normalize(out);
  if (list.length === 0) return textVNode('');
  if (list.length === 1) return list[0]!;
  return h('div', { style: 'display:contents' }, list);
}

/* ------------------------------------------------------------------ */
/* Hooks                                                               */
/* ------------------------------------------------------------------ */

let currentHooks: any[] | null = null;
let hookIndex = 0;
let pendingLayoutEffects: (() => void)[] = [];
let pendingEffects: (() => void)[] = [];

function nextHook(): [any[], number] {
  if (!currentHooks) throw new Error('Hooks can only be called inside components');
  return [currentHooks, hookIndex++];
}

function depsChanged(prev: unknown[] | undefined, next: unknown[] | undefined): boolean {
  if (!prev || !next) return true;
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i++) if (!Object.is(prev[i], next[i])) return true;
  return false;
}

export type StateUpdater<T> = (value: T | ((prev: T) => T)) => void;

export function useState<T>(initial: T | (() => T)): [T, StateUpdater<T>] {
  const [hooks, i] = nextHook();
  if (!(i in hooks)) {
    const slot: { value: T; set: StateUpdater<T> } = {
      value: typeof initial === 'function' ? (initial as () => T)() : initial,
      set: (v) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(slot.value) : v;
        if (!Object.is(next, slot.value)) {
          slot.value = next;
          scheduleRender();
        }
      },
    };
    hooks[i] = slot;
  }
  return [hooks[i].value, hooks[i].set];
}

export function useReducer<S, A>(reducer: (s: S, a: A) => S, initial: S): [S, (a: A) => void] {
  const [state, setState] = useState(initial);
  const ref = useRef(reducer);
  ref.current = reducer;
  const dispatch = useMemo(() => (a: A) => setState((s) => ref.current(s, a)), []);
  return [state, dispatch];
}

export function useRef<T>(initial: T): { current: T };
export function useRef<T = undefined>(): { current: T | undefined };
export function useRef<T>(initial?: T): { current: T | undefined } {
  const [hooks, i] = nextHook();
  if (!(i in hooks)) hooks[i] = { current: initial };
  return hooks[i];
}

export function useMemo<T>(factory: () => T, deps: unknown[]): T {
  const [hooks, i] = nextHook();
  const slot = hooks[i];
  if (!slot || depsChanged(slot.deps, deps)) {
    hooks[i] = { value: factory(), deps };
  }
  return hooks[i].value;
}

export function useCallback<T extends (...args: any[]) => any>(fn: T, deps: unknown[]): T {
  return useMemo(() => fn, deps);
}

type EffectFn = () => void | (() => void);

function effectHook(fn: EffectFn, deps: unknown[] | undefined, queue: (() => void)[]): void {
  const [hooks, i] = nextHook();
  const slot = (hooks[i] ??= { deps: undefined, cleanup: undefined, effect: true });
  if (depsChanged(slot.deps, deps)) {
    slot.deps = deps;
    queue.push(() => {
      if (slot.dead) return;
      if (typeof slot.cleanup === 'function') slot.cleanup();
      slot.cleanup = fn();
    });
  }
}

export function useEffect(fn: EffectFn, deps?: unknown[]): void {
  effectHook(fn, deps, pendingEffects);
}

export function useLayoutEffect(fn: EffectFn, deps?: unknown[]): void {
  effectHook(fn, deps, pendingLayoutEffects);
}

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

const UNITLESS = /^(opacity|zIndex|flex|flexGrow|flexShrink|order|fontWeight|lineHeight|zoom|scale)$/;

type ListenerHost = Element & { _l?: Record<string, (e: Event) => void> };

function proxyListener(this: ListenerHost, e: Event): void {
  this._l?.[e.type]?.(e);
}

function setStyle(dom: HTMLElement, value: any, old: any): void {
  const style = dom.style;
  if (typeof value === 'string') {
    if (style.cssText !== value) style.cssText = value;
    return;
  }
  if (typeof old === 'string') style.cssText = '';
  const prev = old && typeof old === 'object' ? old : {};
  const next = value && typeof value === 'object' ? value : {};
  for (const k in prev) if (!(k in next)) setStyleProp(style, k, '');
  for (const k in next) if (next[k] !== prev[k]) setStyleProp(style, k, next[k]);
}

function setStyleProp(style: CSSStyleDeclaration, k: string, v: any): void {
  const val = v == null || v === false ? '' : typeof v === 'number' && !UNITLESS.test(k) ? v + 'px' : String(v);
  if (k.startsWith('--') || k.includes('-')) style.setProperty(k, val);
  else (style as any)[k] = val;
}

function setProp(dom: Element, name: string, value: any, old: any, svg: boolean): void {
  if (name === 'children' || name === 'ref' || name === 'dangerouslySetInnerHTML' || name === 'autoFocus') return;
  if (name === 'style') return setStyle(dom as HTMLElement, value, old);
  if (name === 'className' || name === 'class') {
    const cls = value || '';
    if (svg) dom.setAttribute('class', cls);
    else if ((dom as HTMLElement).className !== cls) (dom as HTMLElement).className = cls;
    return;
  }
  if (name[0] === 'o' && name[1] === 'n') {
    const host = dom as ListenerHost;
    let type = name.slice(2).toLowerCase();
    if (type === 'doubleclick') type = 'dblclick';
    host._l ??= {};
    if (typeof value === 'function') {
      if (!host._l[type]) dom.addEventListener(type, proxyListener as EventListener);
      host._l[type] = value;
    } else if (host._l[type]) {
      dom.removeEventListener(type, proxyListener as EventListener);
      delete host._l[type];
    }
    return;
  }
  if (name === 'value' || name === 'checked' || name === 'selected' || name === 'indeterminate') {
    const el = dom as any;
    const v = name === 'value' ? (value ?? '') : !!value;
    if (name === 'value' ? String(el.value) !== String(v) : el[name] !== v) el[name] = v;
    return;
  }
  const attr = name === 'htmlFor' ? 'for' : name;
  if (value == null || value === false) {
    if (attr.startsWith('aria-') && value === false) dom.setAttribute(attr, 'false');
    else dom.removeAttribute(attr);
  } else if (value === true && !attr.startsWith('aria-')) {
    dom.setAttribute(attr, '');
  } else {
    dom.setAttribute(attr, String(value));
  }
}

function updateProps(dom: Element, next: Record<string, any>, prev: Record<string, any>, svg: boolean): void {
  for (const k in prev) if (!(k in next)) setProp(dom, k, null, prev[k], svg);
  for (const k in next) {
    const v = next[k];
    if (k === 'value' || k === 'checked' || v !== prev[k]) setProp(dom, k, v, prev[k], svg);
  }
}

function applyRef(ref: any, dom: Node | null): void {
  if (!ref) return;
  if (typeof ref === 'function') ref(dom);
  else ref.current = dom;
}

/* ------------------------------------------------------------------ */
/* Reconciliation                                                      */
/* ------------------------------------------------------------------ */

const toFocus: HTMLElement[] = [];

function sameKind(a: VNode, b: VNode): boolean {
  return a.type === b.type && a.key === b.key;
}

/** Produces (or updates) the DOM for `nv`, reusing `ov` which is known to be of the same kind. */
function patch(nv: VNode, ov: VNode | null, svg: boolean): Node {
  if (nv.type === TEXT) {
    const text = nv.props.nodeValue as string;
    const dom = ov?._dom ?? document.createTextNode(text);
    if (ov && dom.nodeValue !== text) dom.nodeValue = text;
    nv._dom = dom;
    return dom;
  }

  if (typeof nv.type === 'function') {
    nv._hooks = ov?._hooks ?? [];
    const prevHooks = currentHooks;
    const prevIndex = hookIndex;
    currentHooks = nv._hooks;
    hookIndex = 0;
    let out: VNode;
    try {
      out = normalizeRoot((nv.type as ComponentType)(nv.props));
    } finally {
      currentHooks = prevHooks;
      hookIndex = prevIndex;
    }
    const oldOut = ov?._kids?.[0] ?? null;
    const reuse = oldOut && sameKind(out, oldOut) ? oldOut : null;
    const dom = patch(out, reuse, svg);
    if (oldOut && !reuse) unmount(oldOut, true);
    nv._kids = [out];
    nv._dom = dom;
    return dom;
  }

  const type = nv.type as string;
  const isSvg = svg || type === 'svg';
  const created = !ov;
  const dom = (ov?._dom as Element) ?? (isSvg ? document.createElementNS(SVG_NS, type) : document.createElement(type));
  const prevProps = ov?.props ?? {};
  updateProps(dom, nv.props, prevProps, isSvg);

  const html = nv.props.dangerouslySetInnerHTML;
  if (html) {
    if (!prevProps.dangerouslySetInnerHTML || prevProps.dangerouslySetInnerHTML.__html !== html.__html || created) {
      dom.innerHTML = html.__html;
    }
    if (ov?._kids) for (const k of ov._kids) unmount(k, false);
    nv._kids = [];
  } else {
    if (prevProps.dangerouslySetInnerHTML) dom.innerHTML = '';
    nv._kids = reconcile(dom, normalize(nv.props.children), ov?._kids ?? [], isSvg && type !== 'foreignObject');
  }
  // <select value> only sticks once its options exist.
  if (type === 'select' && 'value' in nv.props) (dom as HTMLSelectElement).value = nv.props.value ?? '';

  if (nv.props.ref !== prevProps.ref || created) {
    if (prevProps.ref && prevProps.ref !== nv.props.ref) applyRef(prevProps.ref, null);
    applyRef(nv.props.ref, dom);
  }
  if (created && nv.props.autoFocus) toFocus.push(dom as HTMLElement);
  nv._dom = dom;
  return dom;
}

function reconcile(parent: Element, next: VNode[], prev: VNode[], svg: boolean): VNode[] {
  const keyed = new Map<Key, VNode>();
  const unkeyed: VNode[] = [];
  for (const v of prev) {
    if (v.key != null) keyed.set(v.key, v);
    else unkeyed.push(v);
  }
  const used = new Set<VNode>();
  let unkeyedIndex = 0;
  for (const nv of next) {
    let match: VNode | undefined;
    if (nv.key != null) {
      match = keyed.get(nv.key);
    } else {
      match = unkeyed[unkeyedIndex++];
    }
    if (match && (used.has(match) || !sameKind(nv, match))) match = undefined;
    if (match) used.add(match);
    patch(nv, match ?? null, svg);
  }
  for (const v of prev) if (!used.has(v)) unmount(v, true);

  // Bring the DOM into the order of `next`, moving or inserting as needed.
  let cursor = parent.firstChild;
  for (const nv of next) {
    const dom = nv._dom!;
    if (dom === cursor) cursor = cursor.nextSibling;
    else parent.insertBefore(dom, cursor);
  }
  return next;
}

function unmount(v: VNode, removeDom: boolean): void {
  if (v._hooks) {
    for (const slot of v._hooks) {
      if (slot && slot.effect) {
        slot.dead = true;
        if (typeof slot.cleanup === 'function') slot.cleanup();
      }
    }
  }
  if (typeof v.type === 'string' && v.props.ref) applyRef(v.props.ref, null);
  if (v._kids) for (const k of v._kids) unmount(k, false);
  if (removeDom && v._dom?.parentNode) v._dom.parentNode.removeChild(v._dom);
}

/* ------------------------------------------------------------------ */
/* Root                                                                */
/* ------------------------------------------------------------------ */

let root: { container: Element; template: VNode; tree: VNode | null } | null = null;
let scheduled = false;
let rendering = false;

function flushEffects(): void {
  const layout = pendingLayoutEffects;
  pendingLayoutEffects = [];
  for (const fn of layout) fn();
  while (toFocus.length) {
    const el = toFocus.shift()!;
    if (el.isConnected) el.focus({ preventScroll: true });
  }
  const effects = pendingEffects;
  pendingEffects = [];
  for (const fn of effects) fn();
}

function renderRoot(): void {
  if (!root) return;
  rendering = true;
  try {
    const nv: VNode = { ...root.template, _dom: null, _kids: null };
    const ov = root.tree;
    const dom = patch(nv, ov, false);
    if (!ov) root.container.appendChild(dom);
    else if (ov._dom !== dom) {
      root.container.replaceChild(dom, ov._dom!);
    }
    root.tree = nv;
  } finally {
    rendering = false;
  }
  flushEffects();
}

export function scheduleRender(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    renderRoot();
  });
}

/** Mounts `vnode` into `container`. Later state changes re-render it automatically. */
export function render(vnode: VNode, container: Element): void {
  container.textContent = '';
  root = { container, template: vnode, tree: null };
  renderRoot();
}

/** Forces a synchronous re-render (used by tests and after store hydration). */
export function flushSync(): void {
  if (rendering) return;
  scheduled = false;
  renderRoot();
}

/* ------------------------------------------------------------------ */
/* JSX typing                                                          */
/* ------------------------------------------------------------------ */

declare global {
  namespace JSX {
    type Element = VNode;
    interface ElementChildrenAttribute {
      children: {};
    }
    interface IntrinsicAttributes {
      key?: Key;
    }
    interface IntrinsicElements {
      [tag: string]: any;
    }
  }
}

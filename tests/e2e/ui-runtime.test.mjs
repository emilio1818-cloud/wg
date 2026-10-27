/**
 * Tests for the custom virtual DOM (app/src/lib/ui.ts), executed in real Chromium
 * against the built module. Requires `npm run build`.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/src/app.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let app;
let browser;
let page;

before(async () => {
  app = createApp({ dbPath: ':memory:', staticDir: path.join(root, 'app', 'dist'), rateLimit: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  browser = await chromium.launch();
  page = await browser.newPage();
  // A blank page on the same origin so the module can be imported.
  await page.goto(`http://127.0.0.1:${app.server.address().port}/manifest.webmanifest`);
});

after(async () => {
  await browser?.close();
  await app?.close();
});

/** Runs `fn(ui, root)` in the page with a fresh container; returns its result. */
function run(fn) {
  return page.evaluate(async (src) => {
    const ui = await import('/js/app/src/lib/ui.js');
    const container = document.createElement('div');
    document.body.innerHTML = '';
    document.body.appendChild(container);
    const tick = () => new Promise((r) => setTimeout(r, 0));
    // eslint-disable-next-line no-new-func
    return new Function('ui', 'root', 'tick', `return (${src})(ui, root, tick);`)(ui, container, tick);
  }, fn.toString());
}

describe('ui runtime', () => {
  it('renders elements, attributes, text and SVG', async () => {
    const html = await run((ui, root) => {
      const { h, render } = ui;
      render(h('div', { class: 'a', 'data-x': 1 }, 'hi ', h('b', null, 2), h('svg', { viewBox: '0 0 1 1' }, h('path', { d: 'M0 0' }))), root);
      return { html: root.innerHTML, ns: root.querySelector('path').namespaceURI };
    });
    assert.equal(html.ns, 'http://www.w3.org/2000/svg');
    assert.match(html.html, /^<div class="a" data-x="1">hi <b>2<\/b><svg viewBox="0 0 1 1"><path d="M0 0"><\/path><\/svg><\/div>$/);
  });

  it('keeps component state across re-renders and batches updates', async () => {
    const result = await run(async (ui, root, tick) => {
      const { h, render, useState } = ui;
      let renders = 0;
      let inc;
      function Counter() {
        const [n, setN] = useState(0);
        inc = () => setN((x) => x + 1);
        renders++;
        return h('span', null, n);
      }
      render(h('div', null, h(Counter)), root);
      inc();
      inc();
      inc();
      await tick();
      return { text: root.textContent, renders };
    });
    assert.equal(result.text, '3');
    assert.equal(result.renders, 2);
  });

  it('reorders keyed children by moving existing DOM nodes', async () => {
    const result = await run(async (ui, root, tick) => {
      const { h, render, useState } = ui;
      let set;
      function List() {
        const [items, setItems] = useState(['a', 'b', 'c']);
        set = setItems;
        return h('ul', null, items.map((i) => h('li', { key: i }, i)));
      }
      render(h(List), root);
      const before = [...root.querySelectorAll('li')];
      set(['c', 'a', 'b', 'd']);
      await tick();
      const after = [...root.querySelectorAll('li')];
      return {
        text: after.map((li) => li.textContent).join(''),
        sameA: before[0] === after[1],
        sameC: before[2] === after[0],
      };
    });
    assert.deepEqual(result, { text: 'cabd', sameA: true, sameC: true });
  });

  it('runs effects after render and cleans up on dependency change and unmount', async () => {
    const log = await run(async (ui, root, tick) => {
      const { h, render, useEffect, useState } = ui;
      const log = [];
      let setDep;
      let setShow;
      function Child(p) {
        useEffect(() => {
          log.push('effect ' + p.dep);
          return () => log.push('cleanup ' + p.dep);
        }, [p.dep]);
        return h('i', null, p.dep);
      }
      function App() {
        const [dep, sd] = useState(1);
        const [show, ss] = useState(true);
        setDep = sd;
        setShow = ss;
        return h('div', null, show ? h(Child, { dep }) : null);
      }
      render(h(App), root);
      setDep(2);
      await tick();
      setShow(false);
      await tick();
      return log;
    });
    assert.deepEqual(log, ['effect 1', 'cleanup 1', 'effect 2', 'cleanup 2']);
  });

  it('does not clobber an input while typing and replaces event handlers', async () => {
    const result = await run(async (ui, root, tick) => {
      const { h, render, useState } = ui;
      const calls = [];
      function Form() {
        const [v, setV] = useState('');
        return h('input', { value: v, onInput: (e) => { calls.push(v); setV(e.target.value); } });
      }
      render(h(Form), root);
      const input = root.querySelector('input');
      input.focus();
      input.value = 'ab';
      input.dispatchEvent(new Event('input'));
      await tick();
      input.value = 'abc';
      input.dispatchEvent(new Event('input'));
      await tick();
      return { value: input.value, same: input === root.querySelector('input'), focused: document.activeElement === input, calls };
    });
    // The second handler call sees the updated closure value ('ab'), proving handlers are swapped.
    assert.deepEqual(result, { value: 'abc', same: true, focused: true, calls: ['', 'ab'] });
  });

  it('patches style objects, flattens fragments and renders null as nothing', async () => {
    const result = await run(async (ui, root, tick) => {
      const { h, render, useState, Fragment } = ui;
      let set;
      function App() {
        const [on, s] = useState(true);
        set = s;
        return h(
          'div',
          { style: on ? { color: 'red', '--x': '1px' } : { fontWeight: 700 } },
          h(Fragment, null, h('a', null, 1), h('a', null, 2)),
          on ? null : h('b', null, 'x'),
        );
      }
      render(h(App), root);
      const first = { style: root.firstChild.getAttribute('style'), html: root.firstChild.innerHTML };
      set(false);
      await tick();
      return { first, second: { style: root.firstChild.getAttribute('style'), html: root.firstChild.innerHTML } };
    });
    assert.equal(result.first.style, 'color: red; --x: 1px;');
    assert.equal(result.first.html, '<a>1</a><a>2</a>');
    assert.equal(result.second.style, 'font-weight: 700;');
    assert.equal(result.second.html, '<a>1</a><a>2</a><b>x</b>');
  });

  it('replaces the DOM node when a component switches element type', async () => {
    const html = await run(async (ui, root, tick) => {
      const { h, render, useState } = ui;
      let set;
      function Inner(p) {
        return p.big ? h('h1', null, 'big') : h('p', null, 'small');
      }
      function App() {
        const [big, s] = useState(false);
        set = s;
        return h('section', null, h('span', null, 'a'), h(Inner, { big }), h('span', null, 'b'));
      }
      render(h(App), root);
      set(true);
      await tick();
      return root.innerHTML;
    });
    assert.equal(html, '<section><span>a</span><h1>big</h1><span>b</span></section>');
  });
});

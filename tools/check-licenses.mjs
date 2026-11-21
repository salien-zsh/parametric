// Fails the build when a dependency that ships with the app has a license
// outside the reviewed open-source set (no commercial, source-available or
// custom terms).
//
// 默认只检查「生产依赖闭包」：从根 package.json 的 dependencies 出发，
// 沿 lock 里的 dependencies / optionalDependencies 解析可达包。
// 构建工具（vite、vitest、electron-builder、playwright…）只在本机运行，
// 不进入 dist/ 或桌面安装包，因此它们的传递许可不影响交付物合规。
// 需要审计整个 node_modules 时用 `node tools/check-licenses.mjs --all`。
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const packages = lock.packages;
const approved = new Set([
  'MIT', 'MIT-0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'MPL-2.0',
  'BlueOak-1.0.0', 'CC0-1.0', '0BSD', 'Python-2.0', 'CC-BY-4.0', 'OFL-1.1',
  // The OpenCascade geometry kernel ships as a separate, replaceable WebAssembly module.
  'LGPL-2.1-only',
  '(MIT OR CC0-1.0)', '(MIT OR Apache-2.0)', '(BSD-2-Clause OR MIT OR Apache-2.0)',
  'MIT OR Apache-2.0', 'Apache-2.0 OR MIT', '(MPL-2.0 OR Apache-2.0)',
]);

/** npm 的依赖解析：先查当前包的 node_modules，再逐级向上。 */
function resolveDep(fromLocation, name) {
  let base = fromLocation;
  for (;;) {
    const candidate = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const idx = base.lastIndexOf('/node_modules/');
    base = idx < 0 ? '' : base.slice(0, idx);
  }
}

function productionClosure() {
  const rootPkg = packages[''] || {};
  const names = Object.keys(rootPkg.dependencies || {});
  const seen = new Set();
  const queue = names.map((n) => ({ from: '', name: n }));
  while (queue.length) {
    const { from, name } = queue.shift();
    const loc = resolveDep(from, name);
    if (!loc || seen.has(loc)) continue;
    seen.add(loc);
    const pkg = packages[loc] || {};
    for (const n of Object.keys(pkg.dependencies || {})) queue.push({ from: loc, name: n });
    for (const n of Object.keys(pkg.optionalDependencies || {})) queue.push({ from: loc, name: n });
  }
  return seen;
}

const all = process.argv.includes('--all');
const scope = all ? new Set(Object.keys(packages).filter(Boolean)) : productionClosure();
const failures = [];
for (const location of scope) {
  const pkg = packages[location];
  if (!approved.has(pkg.license)) failures.push(`${location}@${pkg.version}: ${JSON.stringify(pkg.license)}`);
}
if (failures.length) {
  console.error(`Unapproved licenses:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`Licenses OK (${scope.size} ${all ? 'installed' : 'shipped'} packages, ${Object.keys(packages).length - 1} installed in total).`);

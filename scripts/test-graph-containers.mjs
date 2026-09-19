import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
function load(name) {
  const exports = {};
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: id => id.startsWith('./') ? load(id.slice(2)) : require(id) });
  return exports;
}
const { containerLayout, hideCompletedBeads, epicOwners } = load('graph-containers');
const dep = (id, type='parent-child') => ({ depends_on_id:id, type });
const b = (id, extra={}) => ({ id, title:id, status:'open', issue_type:'task', priority:2, dependencies:[], labels:[], ...extra });
const beads = [b('epic', { issue_type:'epic', status:'closed' }),
  b('nested', { issue_type:'epic', dependencies:[dep('epic')] }),
  b('first', { dependencies:[dep('nested')] }),
  b('second', { dependencies:[dep('epic'), dep('first','blocks')] }),
  b('done', { status:'closed', dependencies:[dep('epic')] }), b('standalone')];
const visible = hideCompletedBeads(beads);
assert.ok(visible.some(b=>b.id==='epic'), 'closed epic containing unfinished tasks stays');
assert.ok(!visible.some(b=>b.id==='done'));
const nodes = containerLayout(visible, beads, ()=>{});
const byId = new Map(nodes.map(n=>[n.id,n]));
assert.equal(byId.get('nested').parentId,'epic');
assert.equal(byId.get('first').parentId,'nested');
assert.equal(byId.get('standalone').parentId,undefined);
assert.equal(byId.get('epic').data.completed,1);
assert.equal(byId.get('epic').data.total,3);
function absolute(id) { const n=byId.get(id);const p=n.parentId?absolute(n.parentId):{x:0,y:0};return {x:p.x+n.position.x,y:p.y+n.position.y}; }
assert.ok(absolute('first').x < absolute('second').x, 'cross-epic prerequisite precedes dependent');
for(const n of nodes) if(n.parentId) {
  assert.ok(nodes.findIndex(p=>p.id===n.parentId)<nodes.indexOf(n),'parent emitted first');
  const p=byId.get(n.parentId);
  assert.ok(n.position.x>=0 && n.position.y>=100);
  assert.ok(n.position.x+(n.style?.width??170)<=p.style.width);
}
const cyclic=[b('a',{issue_type:'epic',dependencies:[dep('b')]}),b('b',{issue_type:'epic',dependencies:[dep('a')]})];
assert.equal(epicOwners(cyclic).size,1,'cyclic hierarchy safely broken');
assert.equal(containerLayout(cyclic,cyclic,()=>{}).length,2);
console.log('Container layout fixtures passed');
if (!process.env.SCOTTY_TEST_URL) process.exit(0);
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:1500,height:1100}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/p/demo/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/beads/stream'))return route.abort();
    assert.equal(route.request().method(),'GET','browser test must not mutate data');
    if(path.endsWith('/beads'))return route.fulfill({json:{beads,meta:{kind:'demo',humanActor:'tester',humanAllowlist:['tester'],pollIntervalMs:300000}}});
    return route.fulfill({json:{}});
  });
  const url=process.env.SCOTTY_TEST_URL+'/p/demo?view=graph';
  await page.goto(url);
  const hide=page.getByRole('checkbox',{name:'Hide completed',exact:true});
  await hide.waitFor();assert.ok(await hide.isChecked());
  await page.locator('[data-epic-container="nested"]').waitFor();
  assert.equal(await page.locator('.react-flow__node[data-id="done"]').count(),0);
  await hide.uncheck();await page.locator('.react-flow__node[data-id="done"]').waitFor();
  await page.reload();await hide.waitFor();assert.equal(await hide.isChecked(),false);
  await page.locator('.react-flow__node[data-id="done"]').waitFor();
  await hide.check();await page.locator('.react-flow__node[data-id="done"]').waitFor({state:'detached'});
  await page.waitForTimeout(500);
  const boxes=await page.locator('.react-flow__node').evaluateAll(ns=>Object.fromEntries(ns.map(n=>[n.dataset.id,n.getBoundingClientRect().toJSON()])));
  for(const [child,parent] of [['first','nested'],['nested','epic'],['second','epic']]) {
    assert.ok(boxes[child].left>=boxes[parent].left && boxes[child].right<=boxes[parent].right+1);
    assert.ok(boxes[child].top>boxes[parent].top && boxes[child].bottom<=boxes[parent].bottom+1);
  }
  assert.ok(boxes.first.x<boxes.second.x);
  assert.equal(await page.locator('.react-flow__edge[data-id*="parent-child"]').count(),0);
  assert.equal(await page.locator('.react-flow__edge[data-id="second->first:blocks"]').count(),1);
  await page.screenshot({path:'/tmp/scotty-epic-containers.png'});
  assert.deepEqual(errors,[]);
  console.log('Browser containment, arrows, completed filtering and reload persistence passed');
} finally { await browser.close(); }

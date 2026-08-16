// app.js - Phase2 Milestone A: wiring UI + panning & zoom
// Based on the prototype initial version. Adds:
// - Click-to-connect wiring (output -> input)
// - Temp wire preview and wire deletion (Delete key)
// - Port hit-testing, single-connection per input (replaces existing incoming wire)
// - Panning (middle mouse or space+drag) and zoom (wheel)

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let DPR = window.devicePixelRatio || 1;
function resize(){canvas.width = canvas.clientWidth * DPR; canvas.height = canvas.clientHeight * DPR; ctx.setTransform(DPR,0,0,DPR,0,0)}
window.addEventListener('resize',resize);resize();

// View transform for pan/zoom
const view = {x:0,y:0,scale:1};
function worldToScreen(wx,wy){ return {x:(wx + view.x)*view.scale, y:(wy + view.y)*view.scale} }
function screenToWorld(sx,sy){ return {x: sx/view.scale - view.x, y: sy/view.scale - view.y} }

// Model
let state = {
  nodes:[],
  wires:[],
  nextId:1,
  running:false
}

// Gate definitions (same as prototype)
const GATE_DEFS = {
  AND:{inputs:2,outputs:1,eval:(ins)=> ins.every(x=>x)},
  OR:{inputs:2,outputs:1,eval:(ins)=> ins.some(x=>x)},
  NOT:{inputs:1,outputs:1,eval:(ins)=> !ins[0]},
  NAND:{inputs:2,outputs:1,eval:(ins)=> !ins.every(x=>x)},
  NOR:{inputs:2,outputs:1,eval:(ins)=> !ins.some(x=>x)},
  XOR:{inputs:2,outputs:1,eval:(ins)=> (ins.filter(Boolean).length%2)===1},
  XNOR:{inputs:2,outputs:1,eval:(ins)=> (ins.filter(Boolean).length%2)===0},
  SPLITTER:{inputs:1,outputs:2,eval:(ins)=> [ins[0],ins[0]]},
  BUTTON:{inputs:0,outputs:1,eval:null,button:true},
  LED:{inputs:1,outputs:0,eval:null,display:true},
  TEXT:{inputs:1,outputs:0,eval:null,text:true},
  KEYBOARD:{inputs:0,outputs:1,keyboard:true}
}

// Utils
function addGate(type,x,y){const id = state.nextId++; const def = GATE_DEFS[type]; const node = {id,type,x,y,w:80,h:48,inputs:new Array(def.inputs).fill(false),outputs:new Array(def.outputs).fill(false),label:type,meta:{}}; state.nodes.push(node); return node}

// Compute absolute position of a port
function portPosition(node, kind, index){ // kind: 'in' or 'out'
  const spacing = 14; const margin = 6;
  if(kind==='in'){
    const px = node.x - 6; const py = node.y + margin + index*spacing; return {x:px,y:py}
  } else {
    const px = node.x + node.w + 0; const py = node.y + margin + index*spacing; return {x:px,y:py}
  }
}

// Hit testing for ports
function hitTestPort(worldPos){ // returns {node,kind,index} or null
  for(let i=state.nodes.length-1;i>=0;i--){const n = state.nodes[i]; const def = GATE_DEFS[n.type];
    // inputs
    for(let j=0;j< (def.inputs||0); j++){ const p = portPosition(n,'in',j); if(distance(p,worldPos) < 8) return {node:n,kind:'in',index:j} }
    for(let j=0;j< (def.outputs||0); j++){ const p = portPosition(n,'out',j); if(distance(p,worldPos) < 8) return {node:n,kind:'out',index:j} }
  }
  return null
}
function distance(a,b){const dx=a.x-b.x, dy=a.y-b.y; return Math.sqrt(dx*dx+dy*dy)}

// Wiring helpers
function createWire(fromNode, fromPort, toNode, toPort){ // remove existing wire into that input
  // ensure inputs accept only single incoming wire
  state.wires = state.wires.filter(w=> !(w.to.nodeId===toNode.id && w.to.port===toPort));
  const wi = {id: 'w'+Math.random().toString(36).slice(2,9), from:{nodeId:fromNode.id,port:fromPort}, to:{nodeId:toNode.id,port:toPort}};
  state.wires.push(wi); return wi
}
function findWireNear(worldPos, threshold=8){ // look for any wire segment near point (simple: sample bezier)
  for(const w of state.wires){ const from = state.nodes.find(n=>n.id===w.from.nodeId); const to = state.nodes.find(n=>n.id===w.to.nodeId); if(!from||!to) continue; const p0 = {x: from.x+from.w, y: from.y+from.h/2}; const p3 = {x: to.x, y: to.y+to.h/2}; const p1 = {x:p0.x+40,y:p0.y}; const p2 = {x:p3.x-40,y:p3.y}; // sample points
      for(let t=0;t<=1;t+=0.05){ const x = bezier(p0.x,p1.x,p2.x,p3.x,t); const y = bezier(p0.y,p1.y,p2.y,p3.y,t); if(distance({x,y}, worldPos) < threshold) return w }
  }
  return null
}
function bezier(a,b,c,d,t){ const mt = 1-t; return mt*mt*mt*a + 3*mt*mt*t*b + 3*mt*t*t*c + t*t*t*d }

// Interaction state
let selected=null, dragOff={x:0,y:0}, isDragging=false;
let connectState = null; // {fromNode,fromPort} while creating wire
let hoverPort = null; let selectedWire = null;
let isPanning = false, panStart = null;

// Mouse events
canvas.addEventListener('mousedown', e=>{
  const rect = canvas.getBoundingClientRect(); const sx = (e.clientX - rect.left); const sy = (e.clientY - rect.top);
  const world = screenToWorld(sx,sy);
  // Middle mouse or Space+left for pan
  if(e.button===1 || (e.button===0 && e.shiftKey)){ isPanning=true; panStart={x:e.clientX,y:e.clientY,ox:view.x,oy:view.y}; return }
  const hp = hitTestPort(world);
  if(hp){ if(hp.kind==='out'){ // start connecting
      connectState = {fromNode:hp.node, fromPort:hp.index};
    } else if(hp.kind==='in' && connectState){ // finish connect
      createWire(connectState.fromNode, connectState.fromPort, hp.node, hp.index); connectState=null; evaluate(); redraw();
    } else if(hp.kind==='in'){ // clicked on input - select node
      selected = hp.node; document.getElementById('selected-info').innerText = selected.type+" #"+selected.id; redraw();
    }
    return;
  }
  // click on node body
  const node = nodeAtWorld(world.x, world.y);
  if(node){ selected=node; isDragging=true; dragOff.x = world.x - node.x; dragOff.y = world.y - node.y; document.getElementById('selected-info').innerText = node.type+" #"+node.id; redraw(); return }
  // click on wire selects wire
  const near = findWireNear(world, 8);
  if(near){ selectedWire = near; selected=null; document.getElementById('selected-info').innerText = 'Wire '+near.id; redraw(); return }
  // otherwise clear selection
  selected=null; selectedWire=null; document.getElementById('selected-info').innerText = 'No selection'; redraw();
})

canvas.addEventListener('mousemove', e=>{
  const rect = canvas.getBoundingClientRect(); const sx=(e.clientX-rect.left); const sy=(e.clientY-rect.top); const world=screenToWorld(sx,sy);
  hoverPort = hitTestPort(world);
  if(isPanning && panStart){ const dx = (e.clientX - panStart.x)/view.scale; const dy = (e.clientY - panStart.y)/view.scale; view.x = panStart.ox + dx; view.y = panStart.oy + dy; redraw(); return }
  if(isDragging && selected){ selected.x = world.x - dragOff.x; selected.y = world.y - dragOff.y; redraw(); return }
  if(connectState){ // redraw to show temp wire
    redraw(); // temp wire will be drawn in redraw
    // draw temp
    ctx.save(); ctx.scale(view.scale, view.scale); ctx.beginPath(); const fromP = portPosition(connectState.fromNode,'out',connectState.fromPort); ctx.moveTo(fromP.x, fromP.y); const toP = {x:world.x,y:world.y}; ctx.bezierCurveTo(fromP.x+40,fromP.y, toP.x-40,toP.y, toP.x,toP.y); ctx.strokeStyle='#6cf'; ctx.lineWidth=2/Math.max(0.5,view.scale); ctx.stroke(); ctx.restore();
  }
})

window.addEventListener('mouseup', e=>{ isDragging=false; isPanning=false; panStart=null; });

// zoom
canvas.addEventListener('wheel', e=>{ e.preventDefault(); const rect = canvas.getBoundingClientRect(); const sx=(e.clientX-rect.left); const sy=(e.clientY-rect.top); const worldBefore = screenToWorld(sx,sy); const delta = -e.deltaY*0.001; const newScale = Math.max(0.25, Math.min(3, view.scale * (1+delta))); view.scale = newScale; const worldAfter = screenToWorld(sx,sy); // adjust pan so point under cursor remains
  view.x += (worldAfter.x - worldBefore.x); view.y += (worldAfter.y - worldBefore.y); redraw(); }, {passive:false})

// keyboard: delete selected wire or node
window.addEventListener('keydown', e=>{
  if(e.key==='Delete' || e.key==='Backspace'){
    if(selectedWire){ state.wires = state.wires.filter(w=>w.id !== selectedWire.id); selectedWire = null; redraw(); }
    else if(selected){ state.nodes = state.nodes.filter(n=>n.id!==selected.id); // remove wires attached
      state.wires = state.wires.filter(w=> w.from.nodeId !== selected.id && w.to.nodeId !== selected.id); selected=null; document.getElementById('selected-info').innerText='No selection'; redraw(); }
  }
})

// Node hit test in world coords
function nodeAtWorld(x,y){ for(let i=state.nodes.length-1;i>=0;i--){ const n = state.nodes[i]; if(x>=n.x && x<=n.x+n.w && y>=n.y && y<=n.y+n.h) return n } return null }

// Wire creation via template or programmatic remains supported by createWire

// Simulation (evaluate) similar to prototype but using wires by nodeId
function evaluate(){ state.nodes.forEach(n=>{ if(GATE_DEFS[n.type].outputs) n.outputs = new Array(GATE_DEFS[n.type].outputs).fill(false) });
  // set special gate outputs
  state.nodes.forEach(n=>{ if(n.type==='BUTTON'){ n.outputs[0] = !!n.meta.state } if(n.type==='KEYBOARD'){ n.outputs[0] = n.meta.buffer? true:false } });
  // initialize inputs
  state.nodes.forEach(n=>{ n.inputs = new Array(GATE_DEFS[n.type].inputs).fill(false) });
  state.wires.forEach(w=>{ const from = state.nodes.find(n=>n.id===w.from.nodeId); const to = state.nodes.find(n=>n.id===w.to.nodeId); if(!from||!to) return; const val = from.outputs[w.from.port] || false; to.inputs[w.to.port] = val; });
  // evaluate nodes
  state.nodes.forEach(n=>{ const def = GATE_DEFS[n.type]; if(def.eval){ const res = def.eval(n.inputs); if(def.outputs>1 && Array.isArray(res)) n.outputs = res.map(Boolean); else if(def.outputs>=1) n.outputs[0] = Boolean(res); } if(n.type==='LED'){ n.meta.on = n.inputs[0] } if(n.type==='TEXT'){ if(n.inputs[0]) n.meta.active=true } });
}

// Draw
function redraw(){ ctx.clearRect(0,0,canvas.width,canvas.height); ctx.save(); ctx.scale(view.scale, view.scale); // origin shift handled via worldToScreen helpers
  // transform so world 0,0 maps to view offset
  ctx.translate(view.x, view.y);
  // draw grid
  drawGrid();
  // wires
  for(const w of state.wires){ const from = state.nodes.find(n=>n.id===w.from.nodeId); const to = state.nodes.find(n=>n.id===w.to.nodeId); if(!from||!to) continue; const p0 = {x: from.x+from.w, y: from.y+from.h/2}; const p3 = {x: to.x, y: to.y+to.h/2}; const p1 = {x:p0.x+40,y:p0.y}; const p2 = {x:p3.x-40,y:p3.y}; const on = !!(from.outputs && from.outputs[w.from.port]); ctx.beginPath(); ctx.moveTo(p0.x,p0.y); ctx.bezierCurveTo(p1.x,p1.y,p2.x,p2.y,p3.x,p3.y); ctx.strokeStyle = on? '#6cf' : '#444'; ctx.lineWidth = 3/Math.max(0.5,view.scale); ctx.stroke(); if(selectedWire && selectedWire.id===w.id){ ctx.strokeStyle='#fa7'; ctx.lineWidth = 4/Math.max(0.5,view.scale); ctx.stroke(); } }
  // nodes
  for(const n of state.nodes){ ctx.fillStyle='#222426'; ctx.strokeStyle='#33353a'; ctx.fillRect(n.x,n.y,n.w,n.h); ctx.strokeRect(n.x,n.y,n.w,n.h); ctx.fillStyle='#dfe6ee'; ctx.font='12px sans-serif'; ctx.textAlign='center'; ctx.fillText(n.type, n.x+n.w/2, n.y+n.h/2+4);
    // ports
    const def = GATE_DEFS[n.type]; for(let i=0;i<(def.inputs||0);i++){ const p = portPosition(n,'in',i); ctx.fillStyle='#111'; ctx.fillRect(p.x, p.y, 10,10); }
    for(let i=0;i<(def.outputs||0);i++){ const p = portPosition(n,'out',i); const on = n.outputs && n.outputs[i]; ctx.fillStyle = on? '#6cf' : '#222'; ctx.fillRect(p.x, p.y, 10,10); }
    // selection
    if(selected && selected.id===n.id){ ctx.strokeStyle='rgba(108,204,255,0.7)'; ctx.lineWidth=2/Math.max(0.5,view.scale); ctx.strokeRect(n.x-2,n.y-2,n.w+4,n.h+4); }
  }
  // hover port highlight
  if(hoverPort){ ctx.fillStyle='rgba(108,204,255,0.15)'; const p = portPosition(hoverPort.node, hoverPort.kind, hoverPort.index); ctx.fillRect(p.x-2,p.y-2,14,14); }
  ctx.restore();
}

function drawGrid(){ const step = 40; const w = canvas.width / DPR; const h = canvas.height / DPR; ctx.save(); ctx.strokeStyle='rgba(255,255,255,0.02)'; ctx.lineWidth=1/Math.max(0.5,view.scale); // draw vertical
  const startX = -view.x - ( ( -view.x ) % step ) - step*3; const endX = startX + (w/view.scale) + step*6; for(let x=startX; x<endX; x+=step){ ctx.beginPath(); ctx.moveTo(x, -10000); ctx.lineTo(x, 10000); ctx.stroke(); }
  const startY = -view.y - ((-view.y) % step) - step*3; const endY = startY + (h/view.scale) + step*6; for(let y=startY; y<endY; y+=step){ ctx.beginPath(); ctx.moveTo(-10000,y); ctx.lineTo(10000,y); ctx.stroke(); }
  ctx.restore(); }

// initial demo setup
state = { nodes:[], wires:[], nextId:1, running:false };
// add basic nodes for user to play
const a = addGate('BUTTON', 40, 40); a.meta.state = true; const b = addGate('BUTTON',40,140); b.meta.state=true; const and = addGate('AND', 240, 90); createWire(a,0,and,0); createWire(b,0,and,1); const led = addGate('LED', 420, 90); createWire(and,0,led,0);

evaluate(); redraw();

// Palette click to add gates
document.querySelectorAll('.tool').forEach(t=>{ t.addEventListener('click', ()=>{ const type = t.dataset.type; const node = addGate(type, 100 - view.x, 100 - view.y); selectNode(node); redraw(); }); });
function selectNode(node){ selected = node; document.getElementById('selected-info').innerText = node.type+" #"+node.id }

// Buttons
document.getElementById('btn-run').addEventListener('click', ()=>{ state.running = !state.running; document.getElementById('btn-run').innerText = state.running? 'Pause' : 'Run'; });
document.getElementById('btn-step').addEventListener('click', ()=>{ evaluate(); redraw(); });

// Save/Load hooks
document.getElementById('btn-save').addEventListener('click', ()=>{ const data = JSON.stringify(state); const blob = new Blob([data], {type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='logic-save.json'; a.click(); });
const fin = document.getElementById('file-input'); document.getElementById('btn-load').addEventListener('click', ()=> fin.click()); fin.addEventListener('change', e=>{ const f = e.target.files[0]; const r = new FileReader(); r.onload = ev => { try{ const obj = JSON.parse(ev.target.result); // basic validation
    if(obj && obj.nodes){ state = obj; redraw(); } } catch(err){ alert('Failed to load save: '+err.message) } }; r.readAsText(f); });

// Templates modal hooking
const tmplModal = document.getElementById('templates-modal'); document.getElementById('btn-templates').addEventListener('click', ()=> tmplModal.style.display='flex'); document.getElementById('close-templates').addEventListener('click', ()=> tmplModal.style.display='none');

function loadTemplate(name){ state = {nodes:[], wires:[], nextId:1, running:false}; if(name==='basic-adder'){ const a=addGate('BUTTON',60,60); a.meta.state=true; const b=addGate('BUTTON',60,140); b.meta.state=true; const and=addGate('AND',220,100); state.wires.push({id:'tmp1', from:{nodeId:a.id,port:0}, to:{nodeId:and.id,port:0}}); state.wires.push({id:'tmp2', from:{nodeId:b.id,port:0}, to:{nodeId:and.id,port:1}}); evaluate(); redraw(); } else if(name==='os-demo'){ const k=addGate('KEYBOARD',60,60); k.meta.buffer = "Hello"; const t=addGate('TEXT',260,60); state.wires.push({id:'tmp3',from:{nodeId:k.id,port:0},to:{nodeId:t.id,port:0}}); evaluate(); redraw(); } else { redraw(); } }

document.querySelectorAll('.template-btn').forEach(b=>b.addEventListener('click', ()=>{ loadTemplate(b.dataset.template); tmplModal.style.display='none'; }));

// Keyboard input for KEYBOARD gate and wire deletion
window.addEventListener('keydown', e=>{ if(e.key.length===1){ if(selected && selected.type==='KEYBOARD'){ selected.meta.buffer = (selected.meta.buffer||'') + e.key; evaluate(); redraw(); } } if(e.key==='Delete' || e.key==='Backspace'){ if(selectedWire){ state.wires = state.wires.filter(w=>w.id !== selectedWire.id); selectedWire = null; redraw(); } else if(selected){ state.nodes = state.nodes.filter(n=>n.id !== selected.id); state.wires = state.wires.filter(w=> w.from.nodeId !== selected.id && w.to.nodeId !== selected.id); selected=null; document.getElementById('selected-info').innerText='No selection'; redraw(); } } });

// expose for debugging
window._state = state; window._redraw = redraw; window._evaluate = evaluate;

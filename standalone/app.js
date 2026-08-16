// app.js - Phase2 Milestone B: add stateful gates (SR latch, Gated SR, D latch, Logic Memory)
// Builds on the Milestone A wiring + pan/zoom system.

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

// Gate definitions (extended with stateful gates)
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
  KEYBOARD:{inputs:0,outputs:1,keyboard:true},
  // Statefull primitives
  SR:{inputs:2,outputs:1, stateful:true, pins:['S','R'],
    eval:function(ins,node){ // ins: [S,R]
      const S = !!ins[0]; const R = !!ins[1]; if(S && !R) node.meta.storage = true; else if(R && !S) node.meta.storage = false; else if(S && R) { node.meta.storage = false; } // resolve conflict deterministically
      return !!node.meta.storage;
    }
  },
  GATED_SR:{inputs:3,outputs:1,stateful:true,pins:['S','R','CLK'],
    eval:function(ins,node){ const S=!!ins[0], R=!!ins[1], CLK=!!ins[2]; if(CLK){ if(S && !R) node.meta.storage=true; else if(R && !S) node.meta.storage=false; else if(S&&R) node.meta.storage=false } return !!node.meta.storage },
  },
  DLATCH:{inputs:2,outputs:1,stateful:true,pins:['D','EN'],
    eval:function(ins,node){ const D=!!ins[0], EN=!!ins[1]; if(EN) node.meta.storage = D; return !!node.meta.storage },
  },
  MEMORY:{inputs:3,outputs:1,stateful:true,pins:['DATA','ENABLE','RESET'],
    eval:function(ins,node){ const DATA=!!ins[0], ENABLE=!!ins[1], RESET=!!ins[2]; if(RESET) node.meta.storage=false; else if(ENABLE) node.meta.storage = DATA; // requires "power" in meta to keep state; if no power, clear
      if(node.meta.requirePower && !node.meta.powered){ node.meta.storage = false }
      return !!node.meta.storage },
  }
}

// Utilities
function addGate(type,x,y){const id = state.nextId++; const def = GATE_DEFS[type]; const node = {id,type,x,y,w:100,h:48,inputs:new Array(def.inputs).fill(false),outputs:new Array(def.outputs).fill(false),label:type,meta:{storage:false,requirePower:false,powered:true}}; state.nodes.push(node); return node}

// Compute absolute position of a port
function portPosition(node, kind, index){ const spacing = 14; const margin = 6; if(kind==='in'){ const px = node.x - 6; const py = node.y + margin + index*spacing; return {x:px,y:py} } else { const px = node.x + node.w + 0; const py = node.y + margin + index*spacing; return {x:px,y:py} } }
function distance(a,b){const dx=a.x-b.x, dy=a.y-b.y; return Math.sqrt(dx*dx+dy*dy)}

// Hit testing
function hitTestPort(worldPos){ for(let i=state.nodes.length-1;i>=0;i--){const n = state.nodes[i]; const def = GATE_DEFS[n.type]; for(let j=0;j< (def.inputs||0); j++){ const p = portPosition(n,'in',j); if(distance(p,worldPos) < 8) return {node:n,kind:'in',index:j} } for(let j=0;j< (def.outputs||0); j++){ const p = portPosition(n,'out',j); if(distance(p,worldPos) < 8) return {node:n,kind:'out',index:j} } } return null }

// Wiring
function createWire(fromNode, fromPort, toNode, toPort){ state.wires = state.wires.filter(w=> !(w.to.nodeId===toNode.id && w.to.port===toPort)); const wi = {id: 'w'+Math.random().toString(36).slice(2,9), from:{nodeId:fromNode.id,port:fromPort}, to:{nodeId:toNode.id,port:toPort}}; state.wires.push(wi); return wi }
function findWireNear(worldPos, threshold=8){ for(const w of state.wires){ const from = state.nodes.find(n=>n.id===w.from.nodeId); const to = state.nodes.find(n=>n.id===w.to.nodeId); if(!from||!to) continue; const p0 = {x: from.x+from.w, y: from.y+from.h/2}; const p3 = {x: to.x, y: to.y+to.h/2}; const p1 = {x:p0.x+40,y:p0.y}; const p2 = {x:p3.x-40,y:p3.y}; for(let t=0;t<=1;t+=0.05){ const x = bezier(p0.x,p1.x,p2.x,p3.x,t); const y = bezier(p0.y,p1.y,p2.y,p3.y,t); if(distance({x,y}, worldPos) < threshold) return w } } return null }
function bezier(a,b,c,d,t){ const mt = 1-t; return mt*mt*mt*a + 3*mt*mt*t*b + 3*mt*t*t*c + t*t*t*d }

// Interaction state
let selected=null, dragOff={x:0,y:0}, isDragging=false; let connectState = null; let hoverPort = null; let selectedWire = null; let isPanning=false, panStart=null;

// Mouse events
canvas.addEventListener('mousedown', e=>{ const rect = canvas.getBoundingClientRect(); const sx = (e.clientX - rect.left); const sy = (e.clientY - rect.top); const world = screenToWorld(sx,sy); if(e.button===1 || (e.button===0 && e.shiftKey)){ isPanning=true; panStart={x:e.clientX,y:e.clientY,ox:view.x,oy:view.y}; return } const hp = hitTestPort(world); if(hp){ if(hp.kind==='out'){ connectState = {fromNode:hp.node, fromPort:hp.index}; } else if(hp.kind==='in' && connectState){ createWire(connectState.fromNode, connectState.fromPort, hp.node, hp.index); connectState=null; evaluate(); redraw(); } else if(hp.kind==='in'){ selected = hp.node; renderInspector(); redraw(); } return; } const node = nodeAtWorld(world.x, world.y); if(node){ selected=node; isDragging=true; dragOff.x = world.x - node.x; dragOff.y = world.y - node.y; renderInspector(); redraw(); return } const near = findWireNear(world, 8); if(near){ selectedWire = near; selected=null; renderInspector(); redraw(); return } selected=null; selectedWire=null; renderInspector(); redraw(); })

canvas.addEventListener('mousemove', e=>{ const rect = canvas.getBoundingClientRect(); const sx=(e.clientX-rect.left); const sy=(e.clientY-rect.top); const world=screenToWorld(sx,sy); hoverPort = hitTestPort(world); if(isPanning && panStart){ const dx = (e.clientX - panStart.x)/view.scale; const dy = (e.clientY - panStart.y)/view.scale; view.x = panStart.ox + dx; view.y = panStart.oy + dy; redraw(); return } if(isDragging && selected){ selected.x = world.x - dragOff.x; selected.y = world.y - dragOff.y; renderInspector(); redraw(); return } if(connectState){ redraw(); ctx.save(); ctx.scale(view.scale,view.scale); ctx.beginPath(); const fromP = portPosition(connectState.fromNode,'out',connectState.fromPort); ctx.moveTo(fromP.x, fromP.y); const toP = {x:world.x,y:world.y}; ctx.bezierCurveTo(fromP.x+40,fromP.y, toP.x-40,toP.y, toP.x,toP.y); ctx.strokeStyle='#6cf'; ctx.lineWidth=2/Math.max(0.5,view.scale); ctx.stroke(); ctx.restore(); } })

window.addEventListener('mouseup', e=>{ isDragging=false; isPanning=false; panStart=null; });
canvas.addEventListener('wheel', e=>{ e.preventDefault(); const rect = canvas.getBoundingClientRect(); const sx=(e.clientX-rect.left); const sy=(e.clientY-rect.top); const worldBefore = screenToWorld(sx,sy); const delta = -e.deltaY*0.001; const newScale = Math.max(0.25, Math.min(3, view.scale * (1+delta))); view.scale = newScale; const worldAfter = screenToWorld(sx,sy); view.x += (worldAfter.x - worldBefore.x); view.y += (worldAfter.y - worldBefore.y); redraw(); }, {passive:false})

window.addEventListener('keydown', e=>{ if(e.key.length===1){ if(selected && selected.type==='KEYBOARD'){ selected.meta.buffer = (selected.meta.buffer||'') + e.key; evaluate(); redraw(); } } if(e.key==='Delete' || e.key==='Backspace'){ if(selectedWire){ state.wires = state.wires.filter(w=>w.id !== selectedWire.id); selectedWire = null; renderInspector(); redraw(); } else if(selected){ state.nodes = state.nodes.filter(n=>n.id!==selected.id); state.wires = state.wires.filter(w=> w.from.nodeId !== selected.id && w.to.nodeId !== selected.id); selected=null; renderInspector(); redraw(); } } })

function nodeAtWorld(x,y){ for(let i=state.nodes.length-1;i>=0;i--){ const n = state.nodes[i]; if(x>=n.x && x<=n.x+n.w && y>=n.y && y<=n.y+n.h) return n } return null }

// Simulation
function evaluate(){ // reset outputs
  state.nodes.forEach(n=>{ const def = GATE_DEFS[n.type]; if(def && def.outputs) n.outputs = new Array(def.outputs).fill(false); });
  // set special outputs
  state.nodes.forEach(n=>{ if(n.type==='BUTTON'){ n.outputs[0] = !!n.meta.state } if(n.type==='KEYBOARD'){ n.outputs[0] = n.meta.buffer? true:false } });
  // build inputs from wires
  // start by clearing
  state.nodes.forEach(n=>{ const def = GATE_DEFS[n.type]; n.inputs = new Array(def.inputs).fill(false); });
  state.wires.forEach(w=>{ const from = state.nodes.find(n=>n.id===w.from.nodeId); const to = state.nodes.find(n=>n.id===w.to.nodeId); if(!from||!to) return; const val = !!(from.outputs && from.outputs[w.from.port]); to.inputs[w.to.port] = val; });
  // apply inspector overrides: if user has set testInputs in meta and input is not driven by a wire, use override
  state.nodes.forEach(n=>{ if(n.meta && n.meta.testInputs){ for(let i=0;i<(n.meta.testInputs.length||0);i++){ // only override if there is no incoming wire to that port
        const hasIncoming = state.wires.some(w=> w.to.nodeId===n.id && w.to.port===i); if(!hasIncoming) n.inputs[i] = !!n.meta.testInputs[i]; } } });
  // evaluate nodes (including stateful eval functions)
  state.nodes.forEach(n=>{ const def = GATE_DEFS[n.type]; if(!def) return; if(def.stateful && typeof def.eval === 'function'){ const out = def.eval(n.inputs,n); if(def.outputs>=1){ n.outputs[0] = !!out; } } else if(def.eval){ const out = def.eval(n.inputs); if(def.outputs>1 && Array.isArray(out)) n.outputs = out.map(Boolean); else if(def.outputs>=1) n.outputs[0] = Boolean(out); }
    // LED text
    if(n.type==='LED'){ n.meta.on = n.inputs[0]; }
    if(n.type==='TEXT'){ if(n.inputs[0]) n.meta.active=true }
  });
}

// Draw
function redraw(){ ctx.clearRect(0,0,canvas.width,canvas.height); ctx.save(); ctx.scale(view.scale, view.scale); ctx.translate(view.x, view.y); drawGrid(); // wires
  for(const w of state.wires){ const from = state.nodes.find(n=>n.id===w.from.nodeId); const to = state.nodes.find(n=>n.id===w.to.nodeId); if(!from||!to) continue; const p0 = {x: from.x+from.w, y: from.y+from.h/2}; const p3 = {x: to.x, y: to.y+to.h/2}; const p1 = {x:p0.x+40,y:p0.y}; const p2 = {x:p3.x-40,y:p3.y}; const on = !!(from.outputs && from.outputs[w.from.port]); ctx.beginPath(); ctx.moveTo(p0.x,p0.y); ctx.bezierCurveTo(p1.x,p1.y,p2.x,p2.y,p3.x,p3.y); ctx.strokeStyle = on? '#6cf' : '#444'; ctx.lineWidth = 3/Math.max(0.5,view.scale); ctx.stroke(); if(selectedWire && selectedWire.id===w.id){ ctx.strokeStyle='#fa7'; ctx.lineWidth = 4/Math.max(0.5,view.scale); ctx.stroke(); } }
  // nodes
  for(const n of state.nodes){ ctx.fillStyle='#222426'; ctx.strokeStyle='#33353a'; ctx.fillRect(n.x,n.y,n.w,n.h); ctx.strokeRect(n.x,n.y,n.w,n.h); ctx.fillStyle='#dfe6ee'; ctx.font='12px sans-serif'; ctx.textAlign='center'; ctx.fillText(n.type, n.x+n.w/2, n.y+n.h/2+4);
    const def = GATE_DEFS[n.type]; for(let i=0;i<(def.inputs||0);i++){ const p = portPosition(n,'in',i); ctx.fillStyle='#111'; ctx.fillRect(p.x, p.y, 10,10); // label small
      if(def.pins && def.pins[i]){ ctx.fillStyle='#8f9398'; ctx.font='10px sans-serif'; ctx.textAlign='right'; ctx.fillText(def.pins[i], p.x-4, p.y+9); }
    }
    for(let i=0;i<(def.outputs||0);i++){ const p = portPosition(n,'out',i); const on = n.outputs && n.outputs[i]; ctx.fillStyle = on? '#6cf' : '#222'; ctx.fillRect(p.x, p.y, 10,10); }
    if(selected && selected.id===n.id){ ctx.strokeStyle='rgba(108,204,255,0.7)'; ctx.lineWidth=2/Math.max(0.5,view.scale); ctx.strokeRect(n.x-2,n.y-2,n.w+4,n.h+4); }
    // small indicator for stateful storage
    if(def.stateful){ ctx.fillStyle = n.meta.storage? '#6cf' : '#444'; ctx.fillRect(n.x+n.w-12, n.y+4, 8,8); }
  }
  if(hoverPort){ ctx.fillStyle='rgba(108,204,255,0.15)'; const p = portPosition(hoverPort.node, hoverPort.kind, hoverPort.index); ctx.fillRect(p.x-2,p.y-2,14,14); }
  ctx.restore(); }

function drawGrid(){ const step = 40; const w = canvas.width / DPR; const h = canvas.height / DPR; ctx.save(); ctx.strokeStyle='rgba(255,255,255,0.02)'; ctx.lineWidth=1/Math.max(0.5,view.scale); const startX = -view.x - ( ( -view.x ) % step ) - step*3; const endX = startX + (w/view.scale) + step*6; for(let x=startX; x<endX; x+=step){ ctx.beginPath(); ctx.moveTo(x, -10000); ctx.lineTo(x, 10000); ctx.stroke(); } const startY = -view.y - ((-view.y) % step) - step*3; const endY = startY + (h/view.scale) + step*6; for(let y=startY; y<endY; y+=step){ ctx.beginPath(); ctx.moveTo(-10000,y); ctx.lineTo(10000,y); ctx.stroke(); } ctx.restore(); }

// Inspector rendering and interaction
function renderInspector(){ const info = document.getElementById('selected-info'); const container = document.getElementById('inspector'); if(!selected){ info.innerText = 'No selection'; // clear dynamic area
    const dyn = document.getElementById('inspector-dyn'); if(dyn) dyn.remove(); return } info.innerText = selected.type + ' #' + selected.id; // show dynamic controls
  let dyn = document.getElementById('inspector-dyn'); if(!dyn){ dyn = document.createElement('div'); dyn.id='inspector-dyn'; dyn.style.marginTop='8px'; container.appendChild(dyn); }
  dyn.innerHTML = '';
  // show position & storage
  const pos = document.createElement('div'); pos.innerText = `pos: ${Math.round(selected.x)}, ${Math.round(selected.y)}`; dyn.appendChild(pos);
  const def = GATE_DEFS[selected.type]; if(def.stateful){ const st = document.createElement('div'); st.innerHTML = `<div>Stored: <strong>${selected.meta.storage? '1':'0'}</strong></div>`; dyn.appendChild(st); const toggleBtn = document.createElement('button'); toggleBtn.innerText='Toggle Stored'; toggleBtn.onclick = ()=>{ selected.meta.storage = !selected.meta.storage; evaluate(); redraw(); renderInspector(); }; dyn.appendChild(toggleBtn); }
  // show test input toggles for inputs
  const inputsDiv = document.createElement('div'); inputsDiv.style.marginTop='8px'; inputsDiv.innerHTML = '<div style="margin-bottom:4px">Test Inputs:</div>'; for(let i=0;i<(def.inputs||0);i++){ const row = document.createElement('div'); row.style.marginBottom='4px'; const label = def.pins && def.pins[i]? def.pins[i] : ('in'+i); const cb = document.createElement('input'); cb.type='checkbox'; cb.checked = !!(selected.meta.testInputs && selected.meta.testInputs[i]); cb.onchange = (e)=>{ selected.meta.testInputs = selected.meta.testInputs || []; selected.meta.testInputs[i] = e.target.checked; evaluate(); redraw(); }; row.appendChild(cb); const txt = document.createElement('span'); txt.innerText = ' ' + label; row.appendChild(txt); inputsDiv.appendChild(row); } dyn.appendChild(inputsDiv);
  // If node is BUTTON allow toggling
  if(selected.type==='BUTTON'){ const b = document.createElement('button'); b.innerText = 'Toggle Button'; b.onclick = ()=>{ selected.meta.state = !selected.meta.state; evaluate(); redraw(); renderInspector(); }; dyn.appendChild(b); }
}

// Palette hook
document.querySelectorAll('.tool').forEach(t=>{ t.addEventListener('click', ()=>{ const type = t.dataset.type; const node = addGate(type, 100 - view.x, 100 - view.y); selectNode(node); redraw(); }); });
function selectNode(node){ selected = node; renderInspector(); }

// Buttons
document.getElementById('btn-run').addEventListener('click', ()=>{ state.running = !state.running; document.getElementById('btn-run').innerText = state.running? 'Pause' : 'Run'; });
document.getElementById('btn-step').addEventListener('click', ()=>{ evaluate(); redraw(); });

// Save/Load
document.getElementById('btn-save').addEventListener('click', ()=>{ const data = JSON.stringify(state); const blob = new Blob([data], {type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='logic-save.json'; a.click(); });
const fin = document.getElementById('file-input'); document.getElementById('btn-load').addEventListener('click', ()=> fin.click()); fin.addEventListener('change', e=>{ const f = e.target.files[0]; const r = new FileReader(); r.onload = ev => { try{ const obj = JSON.parse(ev.target.result); if(obj && obj.nodes){ state = obj; renderInspector(); redraw(); } } catch(err){ alert('Failed to load save: '+err.message) } }; r.readAsText(f); });

// Templates
const tmplModal = document.getElementById('templates-modal'); document.getElementById('btn-templates').addEventListener('click', ()=> tmplModal.style.display='flex'); document.getElementById('close-templates').addEventListener('click', ()=> tmplModal.style.display='none');
function loadTemplate(name){ state = {nodes:[], wires:[], nextId:1, running:false}; if(name==='basic-adder'){ const a=addGate('BUTTON',60,60); a.meta.state=true; const b=addGate('BUTTON',60,140); b.meta.state=true; const and=addGate('AND',220,100); state.wires.push({id:'tmp1', from:{nodeId:a.id,port:0}, to:{nodeId:and.id,port:0}}); state.wires.push({id:'tmp2', from:{nodeId:b.id,port:0}, to:{nodeId:and.id,port:1}}); evaluate(); redraw(); } else if(name==='os-demo'){ const k=addGate('KEYBOARD',60,60); k.meta.buffer = "Hello"; const t=addGate('TEXT',260,60); state.wires.push({id:'tmp3',from:{nodeId:k.id,port:0},to:{nodeId:t.id,port:0}}); evaluate(); redraw(); } else if(name==='sr-demo'){ const S = addGate('BUTTON',40,40); S.meta.state=false; const R = addGate('BUTTON',40,120); R.meta.state=false; const sr = addGate('SR', 260, 70); const led = addGate('LED', 420, 80); createWire(S,0,sr,0); createWire(R,0,sr,1); createWire(sr,0,led,0); evaluate(); redraw(); } else if(name==='d-latch-demo'){ const D = addGate('BUTTON',40,40); D.meta.state=true; const EN = addGate('BUTTON',40,120); EN.meta.state=false; const dl = addGate('DLATCH',260,70); const led = addGate('LED',420,80); createWire(D,0,dl,0); createWire(EN,0,dl,1); createWire(dl,0,led,0); evaluate(); redraw(); } else { redraw(); } }

document.querySelectorAll('.template-btn').forEach(b=>b.addEventListener('click', ()=>{ loadTemplate(b.dataset.template); tmplModal.style.display='none'; }));

// initial demo
state = { nodes:[], wires:[], nextId:1, running:false };
const a = addGate('BUTTON', 40, 40); a.meta.state = true; const b = addGate('BUTTON',40,140); b.meta.state=true; const and = addGate('AND', 240, 90); createWire(a,0,and,0); createWire(b,0,and,1); const led = addGate('LED', 420, 90); createWire(and,0,led,0);

evaluate(); redraw(); renderInspector();

// expose for debug
window._state = state; window._redraw = redraw; window._evaluate = evaluate;

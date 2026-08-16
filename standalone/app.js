// app.js - Phase2 Milestone D: grouping/presets + counters & shifters
// Extends the previous app.js with marquee selection (Ctrl+drag), grouping/preset save/load, and counter/shifter gate logic.

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let DPR = window.devicePixelRatio || 1;
function resize(){canvas.width = canvas.clientWidth * DPR; canvas.height = canvas.clientHeight * DPR; ctx.setTransform(DPR,0,0,DPR,0,0)}
window.addEventListener('resize',resize);resize();

// View transform
const view = {x:0,y:0,scale:1};
function worldToScreen(wx,wy){ return {x:(wx + view.x)*view.scale, y:(wy + view.y)*view.scale} }
function screenToWorld(sx,sy){ return {x: sx/view.scale - view.x, y: sy/view.scale - view.y} }

// Model
let state = { nodes:[], wires:[], nextId:1, running:false, presets: loadPresets() };

// Gate definitions (including counters/shifters)
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
  SR:{inputs:2,outputs:1,stateful:true,pins:['S','R'],eval:function(ins,node){const S=!!ins[0],R=!!ins[1]; if(S&&!R) node.meta.storage=true; else if(R&&!S) node.meta.storage=false; else if(S&&R) node.meta.storage=false; return !!node.meta.storage;}},
  DLATCH:{inputs:2,outputs:1,stateful:true,pins:['D','EN'],eval:function(ins,node){const D=!!ins[0],EN=!!ins[1]; if(EN) node.meta.storage = D; return !!node.meta.storage;}},
  MEMORY:{inputs:3,outputs:1,stateful:true,pins:['DATA','ENABLE','RESET'],eval:function(ins,node){const DATA=!!ins[0],ENABLE=!!ins[1],RESET=!!ins[2]; if(RESET) node.meta.storage=false; else if(ENABLE) node.meta.storage = DATA; if(node.meta.requirePower && !node.meta.powered) node.meta.storage = false; return !!node.meta.storage;}},
  EEPROM8:{inputs:19,outputs:8,stateful:true,pins:null,eval:function(ins,node){const DATA_BITS = ins.slice(0,8); const ADDR_BITS = ins.slice(8,16); const SET = !!ins[16]; const RESET = !!ins[17]; const SAVE = !!ins[18]; const addr = bitsToNumber(ADDR_BITS); const dataVal = bitsToNumber(DATA_BITS); if(!node.meta.storageArr) node.meta.storageArr = new Array(256).fill(0); if(RESET){ node.meta.storageArr[addr] = 0; } if(SET){ node.meta.storageArr[addr] = dataVal & 0xFF; } if(SAVE && node.meta.sharedName){ try{ localStorage.setItem('eeprom_'+node.meta.sharedName, JSON.stringify(node.meta.storageArr)); }catch(e){} } const outVal = node.meta.storageArr[addr] || 0; const outBits = numberToBits(outVal,8); for(let i=0;i<8;i++) node.outputs[i] = !!outBits[i]; return node.outputs[0]; }},
  EEPROM16:{inputs:27,outputs:16,stateful:true,pins:null,eval:function(ins,node){const DATA_BITS = ins.slice(0,16); const ADDR_BITS = ins.slice(16,24); const SET = !!ins[24]; const RESET = !!ins[25]; const SAVE = !!ins[26]; const addr = bitsToNumber(ADDR_BITS); const dataVal = bitsToNumber(DATA_BITS); if(!node.meta.storageArr) node.meta.storageArr = new Array(256).fill(0); if(RESET){ node.meta.storageArr[addr] = 0; } if(SET){ node.meta.storageArr[addr] = dataVal & 0xFFFF; } if(SAVE && node.meta.sharedName){ try{ localStorage.setItem('eeprom_'+node.meta.sharedName, JSON.stringify(node.meta.storageArr)); }catch(e){} } const outVal = node.meta.storageArr[addr] || 0; const outBits = numberToBits(outVal,16); for(let i=0;i<16;i++) node.outputs[i] = !!outBits[i]; return node.outputs[0]; }},
  COUNTER4:{inputs:3,outputs:4,stateful:true,pins:['UP','DOWN','RESET'],eval:function(ins,node){ const up=!!ins[0], down=!!ins[1], reset=!!ins[2]; if(!('count' in node.meta)) node.meta.count = 0; if(reset){ node.meta.count = 0; } else if(up && !down){ node.meta.count = (node.meta.count + 1) & 0xF; } else if(down && !up){ node.meta.count = (node.meta.count - 1) & 0xF; } const bits = numberToBits(node.meta.count,4); for(let i=0;i<4;i++) node.outputs[i] = !!bits[i]; return node.outputs[0]; }},
  SHIFTER4:{inputs:3,outputs:4,stateful:true,pins:['CLK','SERIAL_IN','DIR'],eval:function(ins,node){ const CLK=!!ins[0], SIN=!!ins[1], DIR=!!ins[2]; if(!('reg' in node.meta)) node.meta.reg = [false,false,false,false]; // on rising CLK, shift
      if(CLK && !node.meta._lastCLK){ // rising edge
        if(DIR){ // left shift
          node.meta.reg.shift(); node.meta.reg.push(!!SIN);
        } else { // right shift
          node.meta.reg.pop(); node.meta.reg.unshift(!!SIN);
        }
      }
      node.meta._lastCLK = CLK;
      for(let i=0;i<4;i++) node.outputs[i] = !!node.meta.reg[i]; return node.outputs[0]; }},
  SHIFTER8:{inputs:3,outputs:8,stateful:true,pins:['CLK','SERIAL_IN','DIR'],eval:function(ins,node){ const CLK=!!ins[0], SIN=!!ins[1], DIR=!!ins[2]; if(!('reg' in node.meta)) node.meta.reg = new Array(8).fill(false); if(CLK && !node.meta._lastCLK){ if(DIR){ node.meta.reg.shift(); node.meta.reg.push(!!SIN); } else { node.meta.reg.pop(); node.meta.reg.unshift(!!SIN); } } node.meta._lastCLK = CLK; for(let i=0;i<8;i++) node.outputs[i] = !!node.meta.reg[i]; return node.outputs[0]; }}
};

// helpers
function bitsToNumber(bits){ let v=0; for(let i=0;i<bits.length;i++){ if(bits[i]) v |= (1<<i); } return v }
function numberToBits(n,width){ const arr = []; for(let i=0;i<width;i++) arr.push(!!(n & (1<<i))); return arr }

function loadPresets(){ try{ const raw = localStorage.getItem('logic_presets'); if(raw) return JSON.parse(raw); }catch(e){} return [] }
function savePresets(){ try{ localStorage.setItem('logic_presets', JSON.stringify(state.presets)); }catch(e){ console.warn('Failed saving presets',e) } }

// factory
function addGate(type,x,y){ const id = state.nextId++; const def = GATE_DEFS[type]; const node = {id,type,x,y,w:Math.max(100, Math.min(240, 40 + (def.inputs||0)*6)), h:48, inputs:new Array(def.inputs).fill(false), outputs:new Array(def.outputs||0).fill(false), label:type, meta:{storage:false, requirePower:false, powered:true, sharedName:''}}; state.nodes.push(node); return node }

// port pos
function portPosition(node, kind, index){ const spacing = 14; const margin = 6; if(kind==='in'){ const px = node.x - 6; const py = node.y + margin + index*spacing; return {x:px,y:py} } else { const px = node.x + node.w + 0; const py = node.y + margin + index*spacing; return {x:px,y:py} } }
function distance(a,b){const dx=a.x-b.x, dy=a.y-b.y; return Math.sqrt(dx*dx+dy*dy)}

// hit test / wiring
function hitTestPort(worldPos){ for(let i=state.nodes.length-1;i>=0;i--){const n = state.nodes[i]; const def = GATE_DEFS[n.type]; for(let j=0;j< (def.inputs||0); j++){ const p = portPosition(n,'in',j); if(distance(p,worldPos) < 8) return {node:n,kind:'in',index:j} } for(let j=0;j< (def.outputs||0); j++){ const p = portPosition(n,'out',j); if(distance(p,worldPos) < 8) return {node:n,kind:'out',index:j} } } return null }

function createWire(fromNode, fromPort, toNode, toPort){ state.wires = state.wires.filter(w=> !(w.to.nodeId===toNode.id && w.to.port===toPort)); const wi = {id: 'w'+Math.random().toString(36).slice(2,9), from:{nodeId:fromNode.id,port:fromPort}, to:{nodeId:toNode.id,port:toPort}}; state.wires.push(wi); return wi }
function findWireNear(worldPos, threshold=8){ for(const w of state.wires){ const from = state.nodes.find(n=>n.id===w.from.nodeId); const to = state.nodes.find(n=>n.id===w.to.nodeId); if(!from||!to) continue; const p0 = {x: from.x+from.w, y: from.y+from.h/2}; const p3 = {x: to.x, y: to.y+to.h/2}; const p1 = {x:p0.x+40,y:p0.y}; const p2 = {x:p3.x-40,y:p3.y}; for(let t=0;t<=1;t+=0.05){ const x = bezier(p0.x,p1.x,p2.x,p3.x,t); const y = bezier(p0.y,p1.y,p2.y,p3.y,t); if(distance({x,y}, worldPos) < threshold) return w } } return null }
function bezier(a,b,c,d,t){ const mt = 1-t; return mt*mt*mt*a + 3*mt*mt*t*b + 3*mt*t*t*c + t*t*t*d }

// interaction state
let selected=null, selectedNodes = [], dragOff={x:0,y:0}, isDragging=false; let connectState=null; let hoverPort=null; let selectedWire=null; let isPanning=false, panStart=null; let marquee = null; // {x1,y1,x2,y2}

// mouse events
canvas.addEventListener('mousedown', e=>{ const rect = canvas.getBoundingClientRect(); const sx=(e.clientX-rect.left); const sy=(e.clientY-rect.top); const world = screenToWorld(sx,sy); if(e.button===1 || (e.button===0 && e.shiftKey)){ isPanning=true; panStart={x:e.clientX,y:e.clientY,ox:view.x,oy:view.y}; return } // ctrl (or meta) + drag starts marquee selection
  if((e.ctrlKey || e.metaKey) && e.button===0){ marquee = {x1:world.x,y1:world.y,x2:world.x,y2:world.y}; return }
  const hp = hitTestPort(world);
  if(hp){ if(hp.kind==='out'){ connectState = {fromNode:hp.node, fromPort:hp.index}; } else if(hp.kind==='in' && connectState){ createWire(connectState.fromNode, connectState.fromPort, hp.node, hp.index); connectState=null; evaluate(); redraw(); } else if(hp.kind==='in'){ selectSingleNode(hp.node); renderInspector(); redraw(); } return; }
  const node = nodeAtWorld(world.x, world.y);
  if(node){ selectSingleNode(node); isDragging=true; dragOff.x = world.x - node.x; dragOff.y = world.y - node.y; renderInspector(); redraw(); return }
  const near = findWireNear(world,8);
  if(near){ selectedWire = near; selected=null; selectedNodes = []; renderInspector(); redraw(); return }
  // clicked empty space
  selected=null; selectedNodes=[]; renderInspector(); redraw();
})

canvas.addEventListener('mousemove', e=>{ const rect = canvas.getBoundingClientRect(); const sx=(e.clientX-rect.left); const sy=(e.clientY-rect.top); const world=screenToWorld(sx,sy); hoverPort = hitTestPort(world); if(isPanning && panStart){ const dx = (e.clientX - panStart.x)/view.scale; const dy = (e.clientY - panStart.y)/view.scale; view.x = panStart.ox + dx; view.y = panStart.oy + dy; redraw(); return } if(isDragging && selected){ selected.x = world.x - dragOff.x; selected.y = world.y - dragOff.y; // move any additionally selected nodes together
    if(selectedNodes.length>0){ const baseX = selected.x; const baseY = selected.y; // compute offsets
      for(const n of selectedNodes){ if(n.id===selected.id) continue; // keep relative offsets stored in meta
        if(!n.meta._groupOffset){ n.meta._groupOffset = {dx: n.x - selected.x, dy: n.y - selected.y}; }
        n.x = selected.x + n.meta._groupOffset.dx; n.y = selected.y + n.meta._groupOffset.dy; }
    }
    renderInspector(); redraw(); return }
  if(marquee){ marquee.x2 = world.x; marquee.y2 = world.y; // update selection
    const rectw = {x1: Math.min(marquee.x1,marquee.x2), y1: Math.min(marquee.y1,marquee.y2), x2: Math.max(marquee.x1,marquee.x2), y2: Math.max(marquee.y1,marquee.y2)}; selectedNodes = state.nodes.filter(n=> (n.x >= rectw.x1 && n.x + n.w <= rectw.x2 && n.y >= rectw.y1 && n.y + n.h <= rectw.y2)); // highlight
    redraw(); drawMarquee(rectw); return }
  if(connectState){ redraw(); ctx.save(); ctx.scale(view.scale,view.scale); ctx.beginPath(); const fromP = portPosition(connectState.fromNode,'out',connectState.fromPort); ctx.moveTo(fromP.x, fromP.y); const toP = {x:world.x,y:world.y}; ctx.bezierCurveTo(fromP.x+40,fromP.y, toP.x-40,toP.y, toP.x,toP.y); ctx.strokeStyle='#6cf'; ctx.lineWidth=2/Math.max(0.5,view.scale); ctx.stroke(); ctx.restore(); }
})

window.addEventListener('mouseup', e=>{ isDragging=false; isPanning=false; panStart=null; if(marquee){ // finalize marquee selection: selectedNodes already set
    selected = selectedNodes.length>0? selectedNodes[0] : null; marquee = null; renderInspector(); redraw(); } });

canvas.addEventListener('wheel', e=>{ e.preventDefault(); const rect = canvas.getBoundingClientRect(); const sx=(e.clientX-rect.left); const sy=(e.clientY-rect.top); const worldBefore = screenToWorld(sx,sy); const delta = -e.deltaY*0.001; const newScale = Math.max(0.25, Math.min(3, view.scale * (1+delta))); view.scale = newScale; const worldAfter = screenToWorld(sx,sy); view.x += (worldAfter.x - worldBefore.x); view.y += (worldAfter.y - worldBefore.y); redraw(); }, {passive:false})

window.addEventListener('keydown', e=>{ if(e.key.length===1){ if(selected && selected.type==='KEYBOARD'){ selected.meta.buffer = (selected.meta.buffer||'') + e.key; evaluate(); redraw(); } } if(e.key==='Delete' || e.key==='Backspace'){ if(selectedWire){ state.wires = state.wires.filter(w=>w.id !== selectedWire.id); selectedWire = null; renderInspector(); redraw(); } else if(selected){ // delete selected node(s) or selected group
      if(selectedNodes.length>1){ const ids = selectedNodes.map(n=>n.id); state.nodes = state.nodes.filter(n=>!ids.includes(n.id)); state.wires = state.wires.filter(w=> !ids.includes(w.from.nodeId) && !ids.includes(w.to.nodeId)); selected=null; selectedNodes=[]; renderInspector(); redraw(); } else { state.nodes = state.nodes.filter(n=>n.id !== selected.id); state.wires = state.wires.filter(w=> w.from.nodeId !== selected.id && w.to.nodeId !== selected.id); selected=null; renderInspector(); redraw(); } } } })

function nodeAtWorld(x,y){ for(let i=state.nodes.length-1;i>=0;i--){ const n = state.nodes[i]; if(x>=n.x && x<=n.x+n.w && y>=n.y && y<=n.y+n.h) return n } return null }

// simulation
function evaluate(){ // reset outputs
  state.nodes.forEach(n=>{ const def = GATE_DEFS[n.type]; if(def && def.outputs) n.outputs = new Array(def.outputs).fill(false); });
  // preset special outputs
  state.nodes.forEach(n=>{ if(n.type==='BUTTON'){ n.outputs[0] = !!n.meta.state } if(n.type==='KEYBOARD'){ n.outputs[0] = n.meta.buffer? true:false } });
  // init inputs
  state.nodes.forEach(n=>{ const def = GATE_DEFS[n.type]; n.inputs = new Array(def.inputs).fill(false); });
  // propagate wires
  state.wires.forEach(w=>{ const from = state.nodes.find(n=>n.id===w.from.nodeId); const to = state.nodes.find(n=>n.id===w.to.nodeId); if(!from||!to) return; const val = !!(from.outputs && from.outputs[w.from.port]); to.inputs[w.to.port] = val; });
  // inspector overrides
  state.nodes.forEach(n=>{ if(n.meta && n.meta.testInputs){ for(let i=0;i<(n.meta.testInputs.length||0);i++){ const hasIncoming = state.wires.some(w=> w.to.nodeId===n.id && w.to.port===i); if(!hasIncoming) n.inputs[i] = !!n.meta.testInputs[i]; } } });
  // eval each
  state.nodes.forEach(n=>{ const def = GATE_DEFS[n.type]; if(!def) return; if(def.stateful && typeof def.eval === 'function'){ def.eval(n.inputs,n); } else if(def.eval){ const out = def.eval(n.inputs); if(def.outputs>1 && Array.isArray(out)) n.outputs = out.map(Boolean); else if(def.outputs>=1) n.outputs[0] = Boolean(out); } if(n.type==='LED'){ n.meta.on = n.inputs[0]; } if(n.type==='TEXT'){ if(n.inputs[0]) n.meta.active=true } });
}

// draw
function redraw(){ ctx.clearRect(0,0,canvas.width,canvas.height); ctx.save(); ctx.scale(view.scale, view.scale); ctx.translate(view.x, view.y); drawGrid(); // wires
  for(const w of state.wires){ const from = state.nodes.find(n=>n.id===w.from.nodeId); const to = state.nodes.find(n=>n.id===w.to.nodeId); if(!from||!to) continue; const p0 = {x: from.x+from.w, y: from.y+from.h/2}; const p3 = {x: to.x, y: to.y+to.h/2}; const p1 = {x:p0.x+40,y:p0.y}; const p2 = {x:p3.x-40,y:p3.y}; const on = !!(from.outputs && from.outputs[w.from.port]); ctx.beginPath(); ctx.moveTo(p0.x,p0.y); ctx.bezierCurveTo(p1.x,p1.y,p2.x,p2.y,p3.x,p3.y); ctx.strokeStyle = on? '#6cf' : '#444'; ctx.lineWidth = 3/Math.max(0.5,view.scale); ctx.stroke(); if(selectedWire && selectedWire.id===w.id){ ctx.strokeStyle='#fa7'; ctx.lineWidth = 4/Math.max(0.5,view.scale); ctx.stroke(); } }
  // nodes
  for(const n of state.nodes){ ctx.fillStyle='#222426'; ctx.strokeStyle='#33353a'; ctx.fillRect(n.x,n.y,n.w,n.h); ctx.strokeRect(n.x,n.y,n.w,n.h); ctx.fillStyle='#dfe6ee'; ctx.font='12px sans-serif'; ctx.textAlign='center'; ctx.fillText(n.type, n.x+n.w/2, n.y+n.h/2+4);
    const def = GATE_DEFS[n.type]; for(let i=0;i<(def.inputs||0);i++){ const p = portPosition(n,'in',i); ctx.fillStyle='#111'; ctx.fillRect(p.x, p.y, 10,10); if(def.pins && def.pins[i]){ ctx.fillStyle='#8f9398'; ctx.font='10px sans-serif'; ctx.textAlign='right'; ctx.fillText(def.pins[i], p.x-4, p.y+9); } }
    for(let i=0;i<(def.outputs||0);i++){ const p = portPosition(n,'out',i); const on = n.outputs && n.outputs[i]; ctx.fillStyle = on? '#6cf' : '#222'; ctx.fillRect(p.x, p.y, 10,10); }
    if(selected && selected.id===n.id){ ctx.strokeStyle='rgba(108,204,255,0.7)'; ctx.lineWidth=2/Math.max(0.5,view.scale); ctx.strokeRect(n.x-2,n.y-2,n.w+4,n.h+4); }
    if(selectedNodes.some(s=>s.id===n.id)){ ctx.strokeStyle='rgba(255,200,80,0.9)'; ctx.lineWidth=2/Math.max(0.5,view.scale); ctx.strokeRect(n.x-3,n.y-3,n.w+6,n.h+6); }
    if(def.stateful){ ctx.fillStyle = n.meta.storage? '#6cf' : '#444'; ctx.fillRect(n.x+n.w-12, n.y+4, 8,8); }
  }
  if(hoverPort){ ctx.fillStyle='rgba(108,204,255,0.15)'; const p = portPosition(hoverPort.node, hoverPort.kind, hoverPort.index); ctx.fillRect(p.x-2,p.y-2,14,14); }
  ctx.restore(); }

function drawGrid(){ const step = 40; const w = canvas.width / DPR; const h = canvas.height / DPR; ctx.save(); ctx.strokeStyle='rgba(255,255,255,0.02)'; ctx.lineWidth=1/Math.max(0.5,view.scale); const startX = -view.x - ( ( -view.x ) % step ) - step*3; const endX = startX + (w/view.scale) + step*6; for(let x=startX; x<endX; x+=step){ ctx.beginPath(); ctx.moveTo(x, -10000); ctx.lineTo(x, 10000); ctx.stroke(); } const startY = -view.y - ((-view.y) % step) - step*3; const endY = startY + (h/view.scale) + step*6; for(let y=startY; y<endY; y+=step){ ctx.beginPath(); ctx.moveTo(-10000,y); ctx.lineTo(10000,y); ctx.stroke(); } ctx.restore(); }

function drawMarquee(r){ ctx.save(); ctx.scale(view.scale, view.scale); ctx.translate(view.x, view.y); ctx.strokeStyle='rgba(100,200,255,0.8)'; ctx.lineWidth=1/Math.max(0.5,view.scale); ctx.setLineDash([6 / Math.max(0.5,view.scale), 4/Math.max(0.5,view.scale)]); ctx.strokeRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1); ctx.restore(); }

// inspector
function renderInspector(){ const info = document.getElementById('selected-info'); const container = document.getElementById('inspector'); const existingDyn = document.getElementById('inspector-dyn'); if(existingDyn) existingDyn.remove(); const dyn = document.createElement('div'); dyn.id='inspector-dyn'; dyn.style.marginTop='8px'; container.appendChild(dyn);
  if(!selected){ info.innerText = 'No selection'; // show presets list
    const presetsDiv = document.getElementById('presets-list'); presetsDiv.innerHTML = '<h4>Presets</h4>'; for(let i=0;i<state.presets.length;i++){ const p = state.presets[i]; const btn = document.createElement('button'); btn.innerText = p.name; btn.onclick = ()=>{ instantiatePreset(p); }; presetsDiv.appendChild(btn); } return }
  info.innerText = selected.type + ' #' + selected.id; const def = GATE_DEFS[selected.type]; const pos = document.createElement('div'); pos.innerText = `pos: ${Math.round(selected.x)}, ${Math.round(selected.y)}`; dyn.appendChild(pos);
  if(def && def.stateful){ const st = document.createElement('div'); st.innerHTML = `<div>Stored: <strong>${selected.meta.storage? '1':'0'}</strong></div>`; dyn.appendChild(st); const toggleBtn = document.createElement('button'); toggleBtn.innerText='Toggle Stored'; toggleBtn.onclick = ()=>{ selected.meta.storage = !selected.meta.storage; evaluate(); redraw(); renderInspector(); }; dyn.appendChild(toggleBtn); }
  const inputsDiv = document.createElement('div'); inputsDiv.style.marginTop='8px'; inputsDiv.innerHTML = '<div style="margin-bottom:4px">Test Inputs:</div>'; if(def){ for(let i=0;i<(def.inputs||0);i++){ const row = document.createElement('div'); row.style.marginBottom='4px'; const label = def.pins && def.pins[i]? def.pins[i] : ('in'+i); const cb = document.createElement('input'); cb.type='checkbox'; cb.checked = !!(selected.meta.testInputs && selected.meta.testInputs[i]); cb.onchange = (e)=>{ selected.meta.testInputs = selected.meta.testInputs || []; selected.meta.testInputs[i] = e.target.checked; evaluate(); redraw(); }; row.appendChild(cb); const txt = document.createElement('span'); txt.innerText = ' ' + label; row.appendChild(txt); inputsDiv.appendChild(row); } } dyn.appendChild(inputsDiv);
  if(selected.type==='BUTTON'){ const b = document.createElement('button'); b.innerText = 'Toggle Button'; b.onclick = ()=>{ selected.meta.state = !selected.meta.state; evaluate(); redraw(); renderInspector(); }; dyn.appendChild(b); }
  if(selected.type==='EEPROM8' || selected.type==='EEPROM16'){
    const title = document.createElement('div'); title.style.marginTop='8px'; title.innerText = 'EEPROM Controls'; dyn.appendChild(title);
    const shareRow = document.createElement('div'); shareRow.style.marginTop='6px'; shareRow.innerHTML = 'Shared name: '; const shareInput = document.createElement('input'); shareInput.value = selected.meta.sharedName||''; shareInput.onchange = e=>{ selected.meta.sharedName = e.target.value; }; shareRow.appendChild(shareInput); dyn.appendChild(shareRow);
    const addrRow = document.createElement('div'); addrRow.style.marginTop='6px'; addrRow.innerHTML = 'Address: '; const addrInput = document.createElement('input'); addrInput.type='number'; addrInput.min=0; addrInput.value = selected.meta._inspectorAddress||0; addrRow.appendChild(addrInput); dyn.appendChild(addrRow);
    const dataRow = document.createElement('div'); dataRow.style.marginTop='6px'; dataRow.innerHTML = 'Data (hex): '; const dataInput = document.createElement('input'); dataInput.value = selected.meta._inspectorData!==undefined? selected.meta._inspectorData.toString(16): '0'; dataRow.appendChild(dataInput); dyn.appendChild(dataRow);
    const writeBtn = document.createElement('button'); writeBtn.innerText='Write'; writeBtn.onclick=()=>{ const a = Math.floor(Number(addrInput.value) || 0); const d = parseInt(dataInput.value,16) || 0; ensureEepromStorage(selected); if(selected.type==='EEPROM8') selected.meta.storageArr[a & 0xFF] = d & 0xFF; else selected.meta.storageArr[a & 0xFF] = d & 0xFFFF; renderInspector(); evaluate(); redraw(); }; dyn.appendChild(writeBtn);
    const readBtn = document.createElement('button'); readBtn.innerText='Read'; readBtn.style.marginLeft='6px'; readBtn.onclick=()=>{ const a = Math.floor(Number(addrInput.value) || 0); ensureEepromStorage(selected); const val = selected.meta.storageArr[a & 0xFF] || 0; selected.meta._inspectorData = val; dataInput.value = val.toString(16); renderInspector(); evaluate(); redraw(); }; dyn.appendChild(readBtn);
    const resetBtn = document.createElement('button'); resetBtn.innerText='Reset Memory'; resetBtn.style.marginLeft='6px'; resetBtn.onclick=()=>{ ensureEepromStorage(selected); for(let i=0;i<selected.meta.storageArr.length;i++) selected.meta.storageArr[i]=0; if(selected.meta.sharedName){ try{ localStorage.removeItem('eeprom_'+selected.meta.sharedName); }catch(e){} } renderInspector(); evaluate(); redraw(); }; dyn.appendChild(resetBtn);
    const persistBtn = document.createElement('button'); persistBtn.innerText='Persist (save)'; persistBtn.style.marginLeft='6px'; persistBtn.onclick=()=>{ if(!selected.meta.sharedName){ alert('Set a shared name to persist across instances'); return } try{ localStorage.setItem('eeprom_'+selected.meta.sharedName, JSON.stringify(selected.meta.storageArr)); alert('Saved to localStorage key: eeprom_'+selected.meta.sharedName); }catch(e){ alert('Save failed: '+e.message); } }; dyn.appendChild(persistBtn);
    const showRow = document.createElement('div'); showRow.style.marginTop='6px'; ensureEepromStorage(selected); const a2 = Math.floor(Number(addrInput.value)||0); const v2 = selected.meta.storageArr[a2 & 0xFF] || 0; showRow.innerText = 'Value @ address = ' + a2 + ' -> 0x' + v2.toString(16); dyn.appendChild(showRow);
  }
}

function ensureEepromStorage(node){ if(!node.meta.storageArr){ if(node.meta.sharedName){ try{ const raw = localStorage.getItem('eeprom_'+node.meta.sharedName); if(raw){ node.meta.storageArr = JSON.parse(raw); return; } }catch(e){} } const size = 256; node.meta.storageArr = new Array(size).fill(0); } }

// grouping / presets
function saveSelectedAsPreset(name){ if(!selectedNodes || selectedNodes.length===0){ alert('No nodes selected. Use Ctrl+drag to marquee-select nodes and then save.'); return } const group = { name: name || ('preset_'+(state.presets.length+1)), nodes: [], wires: [] }; const idMap = {}; // map old id -> new relative id (index)
  // capture nodes with relative positions
  const minX = Math.min(...selectedNodes.map(n=>n.x)); const minY = Math.min(...selectedNodes.map(n=>n.y)); selectedNodes.forEach((n,idx)=>{ idMap[n.id]=idx; group.nodes.push({type:n.type, x: n.x - minX, y: n.y - minY, w: n.w, h:n.h, meta: JSON.parse(JSON.stringify(n.meta))}); });
  // capture wires between selected nodes
  state.wires.forEach(w=>{ if(idMap[w.from.nodeId]!==undefined && idMap[w.to.nodeId]!==undefined){ group.wires.push({fromIdx:idMap[w.from.nodeId], fromPort:w.from.port, toIdx:idMap[w.to.nodeId], toPort:w.to.port}); } }); state.presets.push(group); savePresets(); renderInspector(); alert('Preset saved: '+group.name); }

function instantiatePreset(preset, atX=100 - view.x, atY=100 - view.y){ const baseId = state.nextId; const created = []; for(let i=0;i<preset.nodes.length;i++){ const n = preset.nodes[i]; const node = addGate(n.type, atX + n.x, atY + n.y); node.meta = JSON.parse(JSON.stringify(n.meta||{})); created.push(node); }
  // recreate wires
  for(const w of preset.wires){ const fromNode = created[w.fromIdx]; const toNode = created[w.toIdx]; createWire(fromNode, w.fromPort, toNode, w.toPort); }
  evaluate(); redraw(); }

// palette hooks
function refreshPresetButtons(){ const presetsDiv = document.getElementById('presets-list'); presetsDiv.innerHTML = '<h4>Presets</h4>'; for(let i=0;i<state.presets.length;i++){ const p = state.presets[i]; const btn = document.createElement('button'); btn.innerText = p.name; btn.onclick = ()=> instantiatePreset(p); presetsDiv.appendChild(btn); } }

document.querySelectorAll('.tool').forEach(t=>{ t.addEventListener('click', ()=>{ const type = t.dataset.type; if(type==='GROUP'){ const name = prompt('Preset name (optional)'); saveSelectedAsPreset(name); refreshPresetButtons(); return } const node = addGate(type, 100 - view.x, 100 - view.y); selectSingleNode(node); redraw(); }); });
refreshPresetButtons();

function selectSingleNode(node){ selected = node; selectedNodes = [node]; renderInspector(); }

// buttons
document.getElementById('btn-run').addEventListener('click', ()=>{ state.running = !state.running; document.getElementById('btn-run').innerText = state.running? 'Pause' : 'Run'; });
document.getElementById('btn-step').addEventListener('click', ()=>{ evaluate(); redraw(); });

// save/load
document.getElementById('btn-save').addEventListener('click', ()=>{ const data = JSON.stringify(state); const blob = new Blob([data], {type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='logic-save.json'; a.click(); });
const fin = document.getElementById('file-input'); document.getElementById('btn-load').addEventListener('click', ()=> fin.click()); fin.addEventListener('change', e=>{ const f = e.target.files[0]; const r = new FileReader(); r.onload = ev => { try{ const obj = JSON.parse(ev.target.result); if(obj && obj.nodes){ state = obj; state.presets = loadPresets(); refreshPresetButtons(); renderInspector(); redraw(); } } catch(err){ alert('Failed to load save: '+err.message) } }; r.readAsText(f); });

// templates
const tmplModal = document.getElementById('templates-modal'); document.getElementById('btn-templates').addEventListener('click', ()=> tmplModal.style.display='flex'); document.getElementById('close-templates').addEventListener('click', ()=> tmplModal.style.display='none');
function loadTemplate(name){ state = {nodes:[], wires:[], nextId:1, running:false, presets: loadPresets()}; if(name==='basic-adder'){ const a=addGate('BUTTON',60,60); a.meta.state=true; const b=addGate('BUTTON',60,140); b.meta.state=true; const and=addGate('AND',220,100); state.wires.push({id:'tmp1', from:{nodeId:a.id,port:0}, to:{nodeId:and.id,port:0}}); state.wires.push({id:'tmp2', from:{nodeId:b.id,port:0}, to:{nodeId:and.id,port:1}}); evaluate(); redraw(); } else if(name==='sr-demo'){ const S = addGate('BUTTON',40,40); S.meta.state=false; const R = addGate('BUTTON',40,120); R.meta.state=false; const sr = addGate('SR', 260, 70); const led = addGate('LED', 420, 80); createWire(S,0,sr,0); createWire(R,0,sr,1); createWire(sr,0,led,0); evaluate(); redraw(); } else if(name==='d-latch-demo'){ const D = addGate('BUTTON',40,40); D.meta.state=true; const EN = addGate('BUTTON',40,120); EN.meta.state=false; const dl = addGate('DLATCH',260,70); const led = addGate('LED',420,80); createWire(D,0,dl,0); createWire(EN,0,dl,1); createWire(dl,0,led,0); evaluate(); redraw(); } else if(name==='eeprom-demo'){ const e = addGate('EEPROM8', 260, 80); e.meta.sharedName = 'demo1'; ensureEepromStorage(e); e.meta.storageArr[5]=0xAB; const setBtn = addGate('BUTTON',40,40); setBtn.meta.state=false; const dataButtons = []; for(let i=0;i<8;i++){ const db = addGate('BUTTON',40, 120 + i*18); db.meta.state = !!((0xAB >> i) & 1); dataButtons.push(db); } for(let i=0;i<8;i++){ createWire(dataButtons[i],0,e,i); } createWire(setBtn,0,e,16); const led = addGate('LED', 420, 80); createWire(e,0,led,0); evaluate(); redraw(); } else if(name==='counter-demo'){ // 4-bit counter with UP/DOWN buttons and LED bits
    const up = addGate('BUTTON',40,40); up.meta.state=false; const down = addGate('BUTTON',40,100); down.meta.state=false; const reset = addGate('BUTTON',40,160); reset.meta.state=false; const counter = addGate('COUNTER4',260,80); createWire(up,0,counter,0); createWire(down,0,counter,1); createWire(reset,0,counter,2); // LEDs for bits
    for(let i=0;i<4;i++){ const l = addGate('LED',420, 60 + i*20); createWire(counter,i,l,0); }
    // shifter demo
    const clk = addGate('BUTTON',40,260); clk.meta.state=false; const sin = addGate('BUTTON',40,320); sin.meta.state=true; const sh = addGate('SHIFTER4',260,260); createWire(clk,0,sh,0); createWire(sin,0,sh,1); createWire(up,0,sh,2); for(let i=0;i<4;i++){ const l = addGate('LED',420, 260 + i*20); createWire(sh,i,l,0); }
    evaluate(); redraw(); }
  else { redraw(); } }

document.querySelectorAll('.template-btn').forEach(b=>b.addEventListener('click', ()=>{ loadTemplate(b.dataset.template); tmplModal.style.display='none'; }));

// initial demo
state = { nodes:[], wires:[], nextId:1, running:false, presets: loadPresets() };
const a = addGate('BUTTON', 40, 40); a.meta.state = true; const b = addGate('BUTTON',40,140); b.meta.state=true; const and = addGate('AND', 240, 90); createWire(a,0,and,0); createWire(b,0,and,1); const led = addGate('LED', 420, 90); createWire(and,0,led,0);

evaluate(); redraw(); renderInspector(); refreshPresetButtons();

// expose for debug
window._state = state; window._redraw = redraw; window._evaluate = evaluate; window._savePresets = savePresets; window._loadPresets = loadPresets;

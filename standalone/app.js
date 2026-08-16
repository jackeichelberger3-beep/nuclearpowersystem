// app.js - Phase2 Milestone C: add EEPROM8/EEPROM16 + inspector UI for EEPROM
// Builds on Milestone A/B wiring, pan/zoom, stateful gates.

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
let state = { nodes:[], wires:[], nextId:1, running:false };

// Gate definitions (extended with EEPROM gates)
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
  GATED_SR:{inputs:3,outputs:1,stateful:true,pins:['S','R','CLK'],eval:function(ins,node){const S=!!ins[0],R=!!ins[1],CLK=!!ins[2]; if(CLK){ if(S&&!R) node.meta.storage=true; else if(R&&!S) node.meta.storage=false; else if(S&&R) node.meta.storage=false } return !!node.meta.storage;}},
  DLATCH:{inputs:2,outputs:1,stateful:true,pins:['D','EN'],eval:function(ins,node){const D=!!ins[0],EN=!!ins[1]; if(EN) node.meta.storage = D; return !!node.meta.storage;}},
  MEMORY:{inputs:3,outputs:1,stateful:true,pins:['DATA','ENABLE','RESET'],eval:function(ins,node){const DATA=!!ins[0],ENABLE=!!ins[1],RESET=!!ins[2]; if(RESET) node.meta.storage=false; else if(ENABLE) node.meta.storage = DATA; if(node.meta.requirePower && !node.meta.powered) node.meta.storage = false; return !!node.meta.storage;}},
  // EEPROM8: inputs = data[0..7], addr[0..7], SET, RESET, SAVE  => total 8+8+3 = 19
  EEPROM8:{inputs:19,outputs:8,stateful:true,pins:null,eval:function(ins,node){const DATA_BITS = ins.slice(0,8); const ADDR_BITS = ins.slice(8,16); const SET = !!ins[16]; const RESET = !!ins[17]; const SAVE = !!ins[18]; const addr = bitsToNumber(ADDR_BITS); const dataVal = bitsToNumber(DATA_BITS); // ensure storage initialized
      if(!node.meta.storageArr) node.meta.storageArr = new Array(256).fill(0);
      if(RESET){ node.meta.storageArr[addr] = 0; }
      if(SET){ node.meta.storageArr[addr] = dataVal & 0xFF; }
      // Save to persistent backing if requested (uses sharedName or node.id)
      if(SAVE && node.meta.sharedName){ try{ localStorage.setItem('eeprom_'+node.meta.sharedName, JSON.stringify(node.meta.storageArr)); }catch(e){ console.warn('EEPROM save failed',e); } }
      const outVal = node.meta.storageArr[addr] || 0; const outBits = numberToBits(outVal,8); // set outputs
      for(let i=0;i<8;i++) node.outputs[i] = !!outBits[i]; return node.outputs[0]; }},
  // EEPROM16: data 16 bits, addr 8 bits, plus 3 controls = 27 inputs, 16 outputs
  EEPROM16:{inputs:27,outputs:16,stateful:true,pins:null,eval:function(ins,node){const DATA_BITS = ins.slice(0,16); const ADDR_BITS = ins.slice(16,24); const SET = !!ins[24]; const RESET = !!ins[25]; const SAVE = !!ins[26]; const addr = bitsToNumber(ADDR_BITS); const dataVal = bitsToNumber(DATA_BITS); if(!node.meta.storageArr) node.meta.storageArr = new Array(256).fill(0); if(RESET){ node.meta.storageArr[addr] = 0; } if(SET){ node.meta.storageArr[addr] = dataVal & 0xFFFF; } if(SAVE && node.meta.sharedName){ try{ localStorage.setItem('eeprom_'+node.meta.sharedName, JSON.stringify(node.meta.storageArr)); }catch(e){} } const outVal = node.meta.storageArr[addr] || 0; const outBits = numberToBits(outVal,16); for(let i=0;i<16;i++) node.outputs[i] = !!outBits[i]; return node.outputs[0];}}
}

// Utility helpers
function bitsToNumber(bits){ let v=0; for(let i=0;i<bits.length;i++){ if(bits[i]) v |= (1<<i); } return v }
function numberToBits(n,width){ const arr = []; for(let i=0;i<width;i++) arr.push(!!(n & (1<<i))); return arr }

// Add gate factory
function addGate(type,x,y){const id = state.nextId++; const def = GATE_DEFS[type]; const node = {id,type,x,y,w:Math.max(100, Math.min(220, 40 + (def.inputs||0)*6)),h:48,inputs:new Array(def.inputs).fill(false),outputs:new Array(def.outputs||0).fill(false),label:type,meta:{storage:false,requirePower:false,powered:true,sharedName:''}}; state.nodes.push(node); return node }

// Port position
function portPosition(node, kind, index){ const spacing = 14; const margin = 6; if(kind==='in'){ const px = node.x - 6; const py = node.y + margin + index*spacing; return {x:px,y:py} } else { const px = node.x + node.w + 0; const py = node.y + margin + index*spacing; return {x:px,y:py} } }
function distance(a,b){const dx=a.x-b.x, dy=a.y-b.y; return Math.sqrt(dx*dx+dy*dy)}

// Hit testing, wiring
function hitTestPort(worldPos){ for(let i=state.nodes.length-1;i>=0;i--){const n = state.nodes[i]; const def = GATE_DEFS[n.type]; for(let j=0;j< (def.inputs||0); j++){ const p = portPosition(n,'in',j); if(distance(p,worldPos) < 8) return {node:n,kind:'in',index:j} } for(let j=0;j< (def.outputs||0); j++){ const p = portPosition(n,'out',j); if(distance(p,worldPos) < 8) return {node:n,kind:'out',index:j} } } return null }

function createWire(fromNode, fromPort, toNode, toPort){ state.wires = state.wires.filter(w=> !(w.to.nodeId===toNode.id && w.to.port===toPort)); const wi = {id: 'w'+Math.random().toString(36).slice(2,9), from:{nodeId:fromNode.id,port:fromPort}, to:{nodeId:toNode.id,port:toPort}}; state.wires.push(wi); return wi }
function findWireNear(worldPos, threshold=8){ for(const w of state.wires){ const from = state.nodes.find(n=>n.id===w.from.nodeId); const to = state.nodes.find(n=>n.id===w.to.nodeId); if(!from||!to) continue; const p0 = {x: from.x+from.w, y: from.y+from.h/2}; const p3 = {x: to.x, y: to.y+to.h/2}; const p1 = {x:p0.x+40,y:p0.y}; const p2 = {x:p3.x-40,y:p3.y}; for(let t=0;t<=1;t+=0.05){ const x = bezier(p0.x,p1.x,p2.x,p3.x,t); const y = bezier(p0.y,p1.y,p2.y,p3.y,t); if(distance({x,y}, worldPos) < threshold) return w } } return null }
function bezier(a,b,c,d,t){ const mt = 1-t; return mt*mt*mt*a + 3*mt*mt*t*b + 3*mt*t*t*c + t*t*t*d }

// Interaction state
let selected=null, dragOff={x:0,y:0}, isDragging=false; let connectState=null; let hoverPort=null; let selectedWire=null; let isPanning=false, panStart=null;

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
  // initialize inputs
  state.nodes.forEach(n=>{ const def = GATE_DEFS[n.type]; n.inputs = new Array(def.inputs).fill(false); });
  // propagate wires
  state.wires.forEach(w=>{ const from = state.nodes.find(n=>n.id===w.from.nodeId); const to = state.nodes.find(n=>n.id===w.to.nodeId); if(!from||!to) return; const val = !!(from.outputs && from.outputs[w.from.port]); to.inputs[w.to.port] = val; });
  // inspector test overrides
  state.nodes.forEach(n=>{ if(n.meta && n.meta.testInputs){ for(let i=0;i<(n.meta.testInputs.length||0);i++){ const hasIncoming = state.wires.some(w=> w.to.nodeId===n.id && w.to.port===i); if(!hasIncoming) n.inputs[i] = !!n.meta.testInputs[i]; } } });
  // evaluate nodes
  state.nodes.forEach(n=>{ const def = GATE_DEFS[n.type]; if(!def) return; if(def.stateful && typeof def.eval === 'function'){ const out = def.eval(n.inputs,n); if(def.outputs>=1){ /* outputs were set inside eval for EEPROM etc. */ } } else if(def.eval){ const out = def.eval(n.inputs); if(def.outputs>1 && Array.isArray(out)) n.outputs = out.map(Boolean); else if(def.outputs>=1) n.outputs[0] = Boolean(out); } // LED text indicators
    if(n.type==='LED'){ n.meta.on = n.inputs[0]; }
    if(n.type==='TEXT'){ if(n.inputs[0]) n.meta.active=true }
  });
}

// Draw
function redraw(){ ctx.clearRect(0,0,canvas.width,canvas.height); ctx.save(); ctx.scale(view.scale, view.scale); ctx.translate(view.x, view.y); drawGrid(); // wires
  for(const w of state.wires){ const from = state.nodes.find(n=>n.id===w.from.nodeId); const to = state.nodes.find(n=>n.id===w.to.nodeId); if(!from||!to) continue; const p0 = {x: from.x+from.w, y: from.y+from.h/2}; const p3 = {x: to.x, y: to.y+to.h/2}; const p1 = {x:p0.x+40,y:p0.y}; const p2 = {x:p3.x-40,y:p3.y}; const on = !!(from.outputs && from.outputs[w.from.port]); ctx.beginPath(); ctx.moveTo(p0.x,p0.y); ctx.bezierCurveTo(p1.x,p1.y,p2.x,p2.y,p3.x,p3.y); ctx.strokeStyle = on? '#6cf' : '#444'; ctx.lineWidth = 3/Math.max(0.5,view.scale); ctx.stroke(); if(selectedWire && selectedWire.id===w.id){ ctx.strokeStyle='#fa7'; ctx.lineWidth = 4/Math.max(0.5,view.scale); ctx.stroke(); } }
  // nodes
  for(const n of state.nodes){ ctx.fillStyle='#222426'; ctx.strokeStyle='#33353a'; ctx.fillRect(n.x,n.y,n.w,n.h); ctx.strokeRect(n.x,n.y,n.w,n.h); ctx.fillStyle='#dfe6ee'; ctx.font='12px sans-serif'; ctx.textAlign='center'; ctx.fillText(n.type, n.x+n.w/2, n.y+n.h/2+4);
    const def = GATE_DEFS[n.type]; for(let i=0;i<(def.inputs||0);i++){ const p = portPosition(n,'in',i); ctx.fillStyle='#111'; ctx.fillRect(p.x, p.y, 10,10); if(def.pins && def.pins[i]){ ctx.fillStyle='#8f9398'; ctx.font='10px sans-serif'; ctx.textAlign='right'; ctx.fillText(def.pins[i], p.x-4, p.y+9); } }
    for(let i=0;i<(def.outputs||0);i++){ const p = portPosition(n,'out',i); const on = n.outputs && n.outputs[i]; ctx.fillStyle = on? '#6cf' : '#222'; ctx.fillRect(p.x, p.y, 10,10); }
    if(selected && selected.id===n.id){ ctx.strokeStyle='rgba(108,204,255,0.7)'; ctx.lineWidth=2/Math.max(0.5,view.scale); ctx.strokeRect(n.x-2,n.y-2,n.w+4,n.h+4); }
    if(def.stateful){ ctx.fillStyle = n.meta.storage? '#6cf' : '#444'; ctx.fillRect(n.x+n.w-12, n.y+4, 8,8); }
  }
  if(hoverPort){ ctx.fillStyle='rgba(108,204,255,0.15)'; const p = portPosition(hoverPort.node, hoverPort.kind, hoverPort.index); ctx.fillRect(p.x-2,p.y-2,14,14); }
  ctx.restore(); }

function drawGrid(){ const step = 40; const w = canvas.width / DPR; const h = canvas.height / DPR; ctx.save(); ctx.strokeStyle='rgba(255,255,255,0.02)'; ctx.lineWidth=1/Math.max(0.5,view.scale); const startX = -view.x - ( ( -view.x ) % step ) - step*3; const endX = startX + (w/view.scale) + step*6; for(let x=startX; x<endX; x+=step){ ctx.beginPath(); ctx.moveTo(x, -10000); ctx.lineTo(x, 10000); ctx.stroke(); } const startY = -view.y - ((-view.y) % step) - step*3; const endY = startY + (h/view.scale) + step*6; for(let y=startY; y<endY; y+=step){ ctx.beginPath(); ctx.moveTo(-10000,y); ctx.lineTo(10000,y); ctx.stroke(); } ctx.restore(); }

// Inspector
function renderInspector(){ const info = document.getElementById('selected-info'); const container = document.getElementById('inspector'); const existingDyn = document.getElementById('inspector-dyn'); if(existingDyn) existingDyn.remove(); const dyn = document.createElement('div'); dyn.id='inspector-dyn'; dyn.style.marginTop='8px'; container.appendChild(dyn);
  if(!selected){ info.innerText = 'No selection'; return } info.innerText = selected.type + ' #' + selected.id; const def = GATE_DEFS[selected.type]; // position
  const pos = document.createElement('div'); pos.innerText = `pos: ${Math.round(selected.x)}, ${Math.round(selected.y)}`; dyn.appendChild(pos);
  // stateful storage controls
  if(def && def.stateful){ const st = document.createElement('div'); st.innerHTML = `<div>Stored: <strong>${selected.meta.storage? '1':'0'}</strong></div>`; dyn.appendChild(st); const toggleBtn = document.createElement('button'); toggleBtn.innerText='Toggle Stored'; toggleBtn.onclick = ()=>{ selected.meta.storage = !selected.meta.storage; evaluate(); redraw(); renderInspector(); }; dyn.appendChild(toggleBtn); }
  // test input toggles
  const inputsDiv = document.createElement('div'); inputsDiv.style.marginTop='8px'; inputsDiv.innerHTML = '<div style="margin-bottom:4px">Test Inputs:</div>'; if(def){ for(let i=0;i<(def.inputs||0);i++){ const row = document.createElement('div'); row.style.marginBottom='4px'; const label = def.pins && def.pins[i]? def.pins[i] : ('in'+i); const cb = document.createElement('input'); cb.type='checkbox'; cb.checked = !!(selected.meta.testInputs && selected.meta.testInputs[i]); cb.onchange = (e)=>{ selected.meta.testInputs = selected.meta.testInputs || []; selected.meta.testInputs[i] = e.target.checked; evaluate(); redraw(); }; row.appendChild(cb); const txt = document.createElement('span'); txt.innerText = ' ' + label; row.appendChild(txt); inputsDiv.appendChild(row); } } dyn.appendChild(inputsDiv);
  // BUTTON control
  if(selected.type==='BUTTON'){ const b = document.createElement('button'); b.innerText = 'Toggle Button'; b.onclick = ()=>{ selected.meta.state = !selected.meta.state; evaluate(); redraw(); renderInspector(); }; dyn.appendChild(b); }
  // Key special: EEPROM inspector
  if(selected.type==='EEPROM8' || selected.type==='EEPROM16'){
    const title = document.createElement('div'); title.style.marginTop='8px'; title.innerText = 'EEPROM Controls'; dyn.appendChild(title);
    // shared name input
    const shareRow = document.createElement('div'); shareRow.style.marginTop='6px'; shareRow.innerHTML = 'Shared name: '; const shareInput = document.createElement('input'); shareInput.value = selected.meta.sharedName||''; shareInput.onchange = e=>{ selected.meta.sharedName = e.target.value; }; shareRow.appendChild(shareInput); dyn.appendChild(shareRow);
    // manual address/data controls
    const addrRow = document.createElement('div'); addrRow.style.marginTop='6px'; addrRow.innerHTML = 'Address: '; const addrInput = document.createElement('input'); addrInput.type='number'; addrInput.min=0; addrInput.value = selected.meta._inspectorAddress||0; addrRow.appendChild(addrInput); dyn.appendChild(addrRow);
    const dataRow = document.createElement('div'); dataRow.style.marginTop='6px'; dataRow.innerHTML = 'Data (hex): '; const dataInput = document.createElement('input'); dataInput.value = selected.meta._inspectorData!==undefined? selected.meta._inspectorData.toString(16): '0'; dataRow.appendChild(dataInput); dyn.appendChild(dataRow);
    const writeBtn = document.createElement('button'); writeBtn.innerText='Write'; writeBtn.onclick=()=>{ const a = Math.floor(Number(addrInput.value) || 0); const d = parseInt(dataInput.value,16) || 0; ensureEepromStorage(selected); if(selected.type==='EEPROM8') selected.meta.storageArr[a & 0xFF] = d & 0xFF; else selected.meta.storageArr[a & 0xFF] = d & 0xFFFF; renderInspector(); evaluate(); redraw(); }; dyn.appendChild(writeBtn);
    const readBtn = document.createElement('button'); readBtn.innerText='Read'; readBtn.style.marginLeft='6px'; readBtn.onclick=()=>{ const a = Math.floor(Number(addrInput.value) || 0); ensureEepromStorage(selected); const val = selected.meta.storageArr[a & 0xFF] || 0; selected.meta._inspectorData = val; dataInput.value = val.toString(16); renderInspector(); evaluate(); redraw(); }; dyn.appendChild(readBtn);
    const resetBtn = document.createElement('button'); resetBtn.innerText='Reset Memory'; resetBtn.style.marginLeft='6px'; resetBtn.onclick=()=>{ ensureEepromStorage(selected); for(let i=0;i<selected.meta.storageArr.length;i++) selected.meta.storageArr[i]=0; if(selected.meta.sharedName){ try{ localStorage.removeItem('eeprom_'+selected.meta.sharedName); }catch(e){} } renderInspector(); evaluate(); redraw(); }; dyn.appendChild(resetBtn);
    const persistBtn = document.createElement('button'); persistBtn.innerText='Persist (save)'; persistBtn.style.marginLeft='6px'; persistBtn.onclick=()=>{ if(!selected.meta.sharedName){ alert('Set a shared name to persist across instances'); return } try{ localStorage.setItem('eeprom_'+selected.meta.sharedName, JSON.stringify(selected.meta.storageArr)); alert('Saved to localStorage key: eeprom_'+selected.meta.sharedName); }catch(e){ alert('Save failed: '+e.message); } }; dyn.appendChild(persistBtn);
    // show sample of current address value
    const showRow = document.createElement('div'); showRow.style.marginTop='6px'; ensureEepromStorage(selected); const a2 = Math.floor(Number(addrInput.value)||0); const v2 = selected.meta.storageArr[a2 & 0xFF] || 0; showRow.innerText = 'Value @ address = ' + a2 + ' -> 0x' + v2.toString(16); dyn.appendChild(showRow);
  }
}

function ensureEepromStorage(node){ if(!node.meta.storageArr){ // try load from shared
    if(node.meta.sharedName){ try{ const raw = localStorage.getItem('eeprom_'+node.meta.sharedName); if(raw){ node.meta.storageArr = JSON.parse(raw); return; } }catch(e){} }
    // default
    const size = 256; node.meta.storageArr = new Array(size).fill(0); } }

// Palette click
document.querySelectorAll('.tool').forEach(t=>{ t.addEventListener('click', ()=>{ const type = t.dataset.type; const node = addGate(type, 100 - view.x, 100 - view.y); selectNode(node); redraw(); }); });
function selectNode(node){ selected = node; renderInspector(); }

// Buttons
document.getElementById('btn-run').addEventListener('click', ()=>{ state.running = !state.running; document.getElementById('btn-run').innerText = state.running? 'Pause' : 'Run'; });
document.getElementById('btn-step').addEventListener('click', ()=>{ evaluate(); redraw(); });

// Save/load
document.getElementById('btn-save').addEventListener('click', ()=>{ const data = JSON.stringify(state); const blob = new Blob([data], {type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='logic-save.json'; a.click(); });
const fin = document.getElementById('file-input'); document.getElementById('btn-load').addEventListener('click', ()=> fin.click()); fin.addEventListener('change', e=>{ const f = e.target.files[0]; const r = new FileReader(); r.onload = ev => { try{ const obj = JSON.parse(ev.target.result); if(obj && obj.nodes){ state = obj; renderInspector(); redraw(); } } catch(err){ alert('Failed to load save: '+err.message) } }; r.readAsText(f); });

// Templates
const tmplModal = document.getElementById('templates-modal'); document.getElementById('btn-templates').addEventListener('click', ()=> tmplModal.style.display='flex'); document.getElementById('close-templates').addEventListener('click', ()=> tmplModal.style.display='none');
function loadTemplate(name){ state = {nodes:[], wires:[], nextId:1, running:false}; if(name==='basic-adder'){ const a=addGate('BUTTON',60,60); a.meta.state=true; const b=addGate('BUTTON',60,140); b.meta.state=true; const and=addGate('AND',220,100); state.wires.push({id:'tmp1', from:{nodeId:a.id,port:0}, to:{nodeId:and.id,port:0}}); state.wires.push({id:'tmp2', from:{nodeId:b.id,port:0}, to:{nodeId:and.id,port:1}}); evaluate(); redraw(); } else if(name==='os-demo'){ const k=addGate('KEYBOARD',60,60); k.meta.buffer = "Hello"; const t=addGate('TEXT',260,60); state.wires.push({id:'tmp3',from:{nodeId:k.id,port:0},to:{nodeId:t.id,port:0}}); evaluate(); redraw(); } else if(name==='sr-demo'){ const S = addGate('BUTTON',40,40); S.meta.state=false; const R = addGate('BUTTON',40,120); R.meta.state=false; const sr = addGate('SR', 260, 70); const led = addGate('LED', 420, 80); createWire(S,0,sr,0); createWire(R,0,sr,1); createWire(sr,0,led,0); evaluate(); redraw(); } else if(name==='d-latch-demo'){ const D = addGate('BUTTON',40,40); D.meta.state=true; const EN = addGate('BUTTON',40,120); EN.meta.state=false; const dl = addGate('DLATCH',260,70); const led = addGate('LED',420,80); createWire(D,0,dl,0); createWire(EN,0,dl,1); createWire(dl,0,led,0); evaluate(); redraw(); } else if(name==='eeprom-demo'){ // create an EEPROM8 with a button to write address 5 = 0xAB and a button to read
    const e = addGate('EEPROM8', 260, 80); e.meta.sharedName = 'demo1'; ensureEepromStorage(e); e.meta.storageArr[5]=0xAB; // prefill
    const addrBtns = [];
    // create a BUTTON that will act as SET with data bits prewired via inspector testInputs
    const setBtn = addGate('BUTTON',40,40); setBtn.meta.state=false;
    // also create 8 data toggles as BUTTONs (for simplicity we place them as single buttons)
    const dataButtons = []; for(let i=0;i<8;i++){ const db = addGate('BUTTON',40, 120 + i*18); db.meta.state = !!((0xAB >> i) & 1); dataButtons.push(db); }
    // wire dataButtons to EEPROM data inputs (0..7)
    for(let i=0;i<8;i++){ createWire(dataButtons[i],0,e,i); }
    createWire(setBtn,0,e,16); // SET input index 16 for EEPROM8
    // LED to show readback
    const led = addGate('LED', 420, 80);
    // wire EEPROM outputs to LED lowest bit (for demo)
    createWire(e,0,led,0);
    evaluate(); redraw(); } else { redraw(); } }

document.querySelectorAll('.template-btn').forEach(b=>b.addEventListener('click', ()=>{ loadTemplate(b.dataset.template); tmplModal.style.display='none'; }));

// initial demo (small)
state = { nodes:[], wires:[], nextId:1, running:false };
const a = addGate('BUTTON', 40, 40); a.meta.state = true; const b = addGate('BUTTON',40,140); b.meta.state=true; const and = addGate('AND', 240, 90); createWire(a,0,and,0); createWire(b,0,and,1); const led = addGate('LED', 420, 90); createWire(and,0,led,0);

evaluate(); redraw(); renderInspector();

// expose for debug
window._state = state; window._redraw = redraw; window._evaluate = evaluate; window._ensureEepromStorage = ensureEepromStorage;

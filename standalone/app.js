// app.js - simplified prototype simulator
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let DPR = window.devicePixelRatio||1;
function resize(){canvas.width = canvas.clientWidth*DPR; canvas.height = canvas.clientHeight*DPR; ctx.setTransform(DPR,0,0,DPR,0,0)}
window.addEventListener('resize',resize);resize();

// Model
let state = {
  nodes:[], // gates
  wires:[],
  nextId:1,
  running:false
}

// Gate definitions
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

// Utilities
function addGate(type,x,y){const id = state.nextId++; const def = GATE_DEFS[type]; const node = {id,type,x,y,w:80,h:48,inputs:new Array(def.inputs).fill(false),outputs:new Array(def.outputs).fill(false),label:type,meta:{}}; state.nodes.push(node); return node}

// Palette drag
document.querySelectorAll('.tool').forEach(t=>{
  t.addEventListener('click',()=>{const type = t.dataset.type; const node = addGate(type,100,100); selectNode(node); redraw()})
})

// Selection & dragging
let selected=null,dragoff={x:0,y:0},isDragging=false
canvas.addEventListener('mousedown',e=>{
  const p = screenToWorld(e.offsetX,e.offsetY);
  const node = nodeAt(p.x,p.y);
  if(node){selected=node;isDragging=true;dragoff.x=p.x-node.x;dragoff.y=p.y-node.y;document.getElementById('selected-info').innerText=node.type+" #"+node.id}
  else{selected=null;document.getElementById('selected-info').innerText='No selection'}
})
window.addEventListener('mousemove',e=>{if(isDragging && selected){const p=screenToWorld(e.offsetX,e.offsetY);selected.x=p.x-dragoff.x;selected.y=p.y-dragoff.y;redraw();}})
window.addEventListener('mouseup',()=>{isDragging=false})

function nodeAt(x,y){for(let i=state.nodes.length-1;i>=0;i--){const n=state.nodes[i];if(x>=n.x&&x<=n.x+n.w&&y>=n.y&&y<=n.y+n.h)return n}return null}
function screenToWorld(sx,sy){const rect = canvas.getBoundingClientRect();return {x:sx,y:sy}} 

// Wire creation (click output to start, then click target input)
let currentWire = null
canvas.addEventListener('dblclick',e=>{
  const p = screenToWorld(e.offsetX,e.offsetY);
  const n = nodeAt(p.x,p.y);
  if(!n) return;
  // toggle button or keyboard focus
  if(n.type==='BUTTON'){ n.meta.state = !n.meta.state; redraw(); }
})

// Simulation
function evaluate(){
  // Reset outputs
  state.nodes.forEach(n=>{if(GATE_DEFS[n.type].outputs) n.outputs = new Array(GATE_DEFS[n.type].outputs).fill(false)})
  // First, set button/keyboard outputs from meta
  state.nodes.forEach(n=>{
    if(n.type==='BUTTON'){n.outputs[0]=!!n.meta.state}
    if(n.type==='KEYBOARD'){n.outputs[0] = n.meta.buffer? true:false}
  })
  // Propagate wires by building input lists
  state.nodes.forEach(n=>{n.inputs = new Array(GATE_DEFS[n.type].inputs).fill(false)})
  state.wires.forEach(w=>{
    const from = state.nodes.find(x=>x.id===w.from.id);
    const to = state.nodes.find(x=>x.id===w.to.id);
    if(!from||!to) return;
    const val = from.outputs[w.from.port] || false;
    to.inputs[w.to.port] = val;
  })
  // Evaluate gates
  state.nodes.forEach(n=>{
    const def = GATE_DEFS[n.type];
    if(def.eval){
      const res = def.eval(n.inputs);
      if(def.outputs>1 && Array.isArray(res)) n.outputs = res.map(Boolean);
      else n.outputs[0] = Boolean(res)
    }
    // LED/Text receive input and store
    if(n.type==='LED'){n.meta.on = n.inputs[0]}
    if(n.type==='TEXT'){ if(n.inputs[0]) n.meta.active=true; }
    if(n.type==='KEYBOARD' && n.meta.buffer){ /* keep buffer until consumed by wire consumer (simple) */ }
  })
}

// Main draw
function redraw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // draw wires
  state.wires.forEach(w=>{
    const from = state.nodes.find(x=>x.id===w.from.id);
    const to = state.nodes.find(x=>x.id===w.to.id);
    if(!from||!to) return;
    const fx = from.x+from.w; const fy = from.y+from.h/2;
    const tx = to.x; const ty = to.y+to.h/2;
    const on = from.outputs[w.from.port];
    ctx.beginPath(); ctx.moveTo(fx,fy); ctx.bezierCurveTo(fx+40,fy,tx-40,ty,tx,ty); ctx.strokeStyle = on? '#6cf' : '#444'; ctx.lineWidth=3; ctx.stroke();
  })
  // draw nodes
  state.nodes.forEach(n=>{
    ctx.fillStyle = '#222426'; ctx.strokeStyle='#33353a'; ctx.fillRect(n.x,n.y,n.w,n.h); ctx.strokeRect(n.x,n.y,n.w,n.h);
    ctx.fillStyle = '#dfe6ee'; ctx.font='12px sans-serif'; ctx.textAlign='center'; ctx.fillText(n.type, n.x+n.w/2, n.y+n.h/2+4);
    // ports
    for(let i=0;i<(GATE_DEFS[n.type].inputs||0);i++){
      ctx.fillStyle='#111'; ctx.fillRect(n.x-6, n.y+6 + i*14,10,10);
    }
    for(let i=0;i<(GATE_DEFS[n.type].outputs||0);i++){
      const on = n.outputs[i]; ctx.fillStyle = on? '#6cf' : '#222'; ctx.fillRect(n.x+n.w-4, n.y+6 + i*14,10,10);
    }
  })
}

// Run loop
setInterval(()=>{ if(state.running){ evaluate(); redraw() }},200);

// Controls
document.getElementById('btn-run').addEventListener('click',()=>{state.running=!state.running; document.getElementById('btn-run').innerText = state.running? 'Pause':'Run';})
document.getElementById('btn-step').addEventListener('click',()=>{ evaluate(); redraw() })

// Save/Load
document.getElementById('btn-save').addEventListener('click',()=>{ const data = JSON.stringify(state); const blob = new Blob([data],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='logic-save.json'; a.click(); })
const fin = document.getElementById('file-input');
document.getElementById('btn-load').addEventListener('click',()=>fin.click()); fin.addEventListener('change',e=>{const f=e.target.files[0]; const r=new FileReader(); r.onload=ev=>{ const obj = JSON.parse(ev.target.result); state = obj; redraw(); }; r.readAsText(f)})

// Templates modal
const tmplModal = document.getElementById('templates-modal'); document.getElementById('btn-templates').addEventListener('click',()=>tmplModal.style.display='flex'); document.getElementById('close-templates').addEventListener('click',()=>tmplModal.style.display='none');
document.querySelectorAll('.template-btn').forEach(b=>b.addEventListener('click',()=>{loadTemplate(b.dataset.template); tmplModal.style.display='none'}))
function loadTemplate(name){state = {nodes:[],wires:[],nextId:1,running:false}; if(name==='basic-adder'){ const a=addGate('BUTTON',60,60); a.meta.state=true; const b=addGate('BUTTON',60,140); b.meta.state=true; const and=addGate('AND',220,100); state.wires.push({from:{id:a.id,port:0},to:{id:and.id,port:0}}); state.wires.push({from:{id:b.id,port:0},to:{id:and.id,port:1}}); evaluate(); redraw(); } else if(name==='os-demo'){ const k=addGate('KEYBOARD',60,60); k.meta.buffer = "Hello"; const t=addGate('TEXT',260,60); state.wires.push({from:{id:k.id,port:0},to:{id:t.id,port:0}}); evaluate(); redraw(); } else { redraw(); }}

// Keyboard gate capturing
window.addEventListener('keydown',e=>{
  // if keyboard gate selected, push into its buffer
  if(selected && selected.type==='KEYBOARD'){ selected.meta.buffer = (selected.meta.buffer||'') + e.key; evaluate(); redraw(); }
})

// Initial demo
addGate('BUTTON',40,40).meta.state=true; addGate('LED',340,40);
redraw();

// expose for debug
window._state = state; window._redraw=redraw; window._evaluate=evaluate;

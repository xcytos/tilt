(() => {
'use strict';
const $ = id => document.getElementById(id);
const STORE='flower-panel-studio-v2', THEME='flower-panel-theme-v1';
// The TILT scene listens on this channel so a save here updates its shelf list
// and any mounted panel that references the arrangement, without a reload.
const FLOWERS_CHANNEL = typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('flower-panel-changed') : null;
let colors=[{id:1,name:'White',hex:'#ffffff'}], nextColorId=2, saved=[], currentId=null, currentName=null;
let scene,camera,renderer,controls,group,resizeObserver,threeReady=false;
let activeFlowerMeshes=[], backingMesh=null, borderFrameMeshes={}, borderFlowerMeshes={}, borderGreeneryMeshes={};
 let greeneryMeshes=[], greeneryGroup=null;
 let borderLayers=[]; // ordered outside->inside; mirrors model border.layers (UI shadow)
 const borderCollapsed=new Set(); // view-only: collapsed border cards (by layer id)
 const defaultFlowerBorder=()=>({type:'flower',enabled:true,flowerType:'rose',flowerSize:4,width:4,density:70,colorMode:'independent',color:'#ffc0cb',arrangement:'continuous',rotation:30});
 const defaultFrameBorder=()=>({type:'frame',enabled:true,width:6,color:'#D4AF37',depth:2});
 const defaultGreeneryBorder=()=>({type:'greenery',enabled:true,species:'monstera',width:4,sizeScale:1,density:70,overlap:0.5,rotationVariation:60,colorVariation:0.3});
 const defaultGreeneryItems=()=>[
  {type:'monstera',enabled:true,sizeScale:1,density:70,proportion:30,layer:'structural',colorVariation:0.3},
  {type:'eucalyptus',enabled:true,sizeScale:1,density:70,proportion:40,layer:'volume',colorVariation:0.3},
  {type:'boston-fern',enabled:true,sizeScale:1,density:70,proportion:30,layer:'filler',colorVariation:0.3}
 ];
 const defaults=()=>({name:'Untitled arrangement',width:8,height:8,flowerSize:5,flowerType:'rose',coverage:100,pattern:'nongrouping',mixIntensity:'high',groupingLimit:'balanced',clusterSize:'small',patternDirection:'ltr',seed:1,border:{layers:[]},designMode:'flowers',greenery:{mode:'mixed',direction:'mixed',overlap:0.5,rotationVariation:60,seed:1,items:defaultGreeneryItems()},colors:[{id:1,name:'White',hex:'#ffffff'}]});
 let greeneryItems=defaultGreeneryItems();
const model=window.FlowerModel;
const engine=window.FlowerEngine;
const greenEngine=window.GreeneryEngine;
const debug=(level,message,details)=>{try{const d=window.FlowerDiagnostics;if(d&&typeof d[level]==='function')d[level](message,details);else if(d&&typeof d.log==='function')d.log(level,message,details);}catch(_){}};
function status(msg,error=false){$('status').textContent=msg;$('status').classList.toggle('error',error);debug(error?'error':'info','UI status: '+msg)}
function previewStatus(msg,show=true,level='info'){$('previewStatus').textContent=msg;$('previewStatus').classList.toggle('visible',show);debug(level,'Preview status: '+msg)}
function nameForColor(hex){const names={'#ffffff':'White','#fffaf0':'Ivory','#ffc0cb':'Pink','#ffb6c1':'Light pink','#f4a6b8':'Blush','#d8efcf':'Light green','#9fc89b':'Sage green','#ffff00':'Yellow','#ffd166':'Warm yellow','#ff0000':'Red','#c1121f':'Deep red','#dda0dd':'Plum','#cdb4db':'Lavender','#87ceeb':'Sky blue','#f4a261':'Terracotta','#d4af37':'Gold','#000000':'Black'};return names[hex.toLowerCase()]||hex.toUpperCase()}
 // Small deterministic PRNG for per-flower rotation within a border.
  function seededRand(seed){let a=(seed>>>0)||1;return function(){a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
  function readGreenery(){
  const g=id=>$(id);
  const num=(el,d)=>{const n=Number(el&&el.value);return isFinite(n)?n:d};
  return {mode:g('greeneryMode')?g('greeneryMode').value:'single',direction:g('greeneryDirection')?g('greeneryDirection').value:'mixed',overlap:num(g('greeneryOverlap'),0.5),rotationVariation:num(g('greeneryRotation'),60),seed:Math.abs(Math.floor(num(g('greenerySeed'),1)))>>>0,items:greeneryItems};
 }
 function settings(){return model.normalize({name:$('arrangementName').value.trim()||'Untitled arrangement',width:$('width').value,height:$('height').value,flowerSize:$('flowerSize').value,flowerType:$('flowerType').value,coverage:$('coverage').value,pattern:$('pattern').value,mixIntensity:$('mixIntensity').value,groupingLimit:$('groupingLimit').value,clusterSize:$('clusterSize').value,patternDirection:$('patternDirection').value,seed:Number($('seed').value)||1,border:{layers:borderLayers},flowersOn:$('flowersOn')?$('flowersOn').checked:true,greeneryOn:$('greeneryOn')?$('greeneryOn').checked:false,composition:$('composition')?$('composition').value:'greenery-base',flowerLeaves:$('flowerLeaves')?$('flowerLeaves').checked:false,greenery:readGreenery(),colors})}
 function updateSummary(){const s=settings(),pos=model.positions(s);let borderFlowers=0;for(const l of s.border.layers){if(l.enabled&&l.type==='flower')borderFlowers+=model.borderPositions(s,l.id).length}let borderGreenery=0;for(const l of s.border.layers){if(l.enabled&&l.type==='greenery')borderGreenery+=model.greeneryBorderPositions(s,l.id).length}const total=pos.length+borderFlowers;const set=(id,val)=>{const el=$(id);if(el)el.textContent=val};set('totalCount',total.toLocaleString());const sp=engine&&engine.get?engine.get(s.flowerType):null;set('dimensionLabel',`${s.width} ft × ${s.height} ft · ${sp?sp.label:s.flowerType} heads · 2 in foam`);set('coverageLabel',s.coverage===100?'Full-face coverage target':`${s.coverage}% coverage target`);set('densityValue',s.coverage+'%');set('previewName',s.name);const gEst=model.greeneryEstimate(s);renderGreeneryInventory(gEst,s);const greTotal=gEst.totalItems+borderGreenery;const head=s.designMode==='greenery'?`${greTotal.toLocaleString()} greenery pieces · ${s.width}×${s.height} ft panel`:s.designMode==='mixed'?`${total.toLocaleString()} flowers + ${greTotal.toLocaleString()} greenery · ${s.width}×${s.height} ft panel`:`${total.toLocaleString()} flowers · ${s.width}×${s.height} ft panel`;set('headerCount',head);renderColorCounts(pos.length)}
function renderGreeneryInventory(est,s){const root=$('greeneryInventory');if(!root)return;const mode=s&&s.designMode?s.designMode:'flowers';if(mode==='flowers'){root.innerHTML='<div class="inv-empty">Flowers-only design — no greenery placed. Choose “Greenery only” or “Flowers + greenery” above to add a base.</div>';return}if(!est||!est.totalItems){root.innerHTML='<div class="inv-empty">No greenery placed at these settings.</div>';return}const rows=est.items.filter(it=>it.count>0).map(it=>`<div class="inv-row"><span>${it.label}</span><span>${it.count.toLocaleString()} pcs</span></div>`).join('');const placed=est.totalItems-(est.omitted||0);const omitted=est.omitted&&est.omitted>0?`<div class="inv-row inv-omitted"><span>Not placed (no room inside panel)</span><span>${est.omitted.toLocaleString()}</span></div>`:'';root.innerHTML=`<div class="inv-row inv-total"><span>Pieces placed</span><span>${placed.toLocaleString()}</span></div>`+rows+omitted+`<div class="inv-row inv-total"><span>Footprint coverage</span><span>${Math.round((est.estimatedCoverage||0)*100)}%</span></div>`}
function renderColorCounts(n){const rows=[...$('colors').querySelectorAll('.color-row .count')],counts=model.counts(settings(),n);rows.forEach((el,i)=>el.textContent=(counts[i]?.count||0).toLocaleString())}
function renderColors(){const root=$('colors');root.innerHTML='';colors.forEach((c,i)=>{const row=document.createElement('div');row.className='color-row';row.innerHTML=`<input aria-label="${c.name} color" type="color" value="${model.cleanHex(c.hex)}"><div><div class="color-name"></div><div class="sub">Color ${i+1} of ${colors.length}</div></div><div class="count">0</div>`;row.querySelector('.color-name').textContent=c.name;const picker=row.querySelector('input');picker.addEventListener('input',e=>{c.hex=e.target.value;c.name=nameForColor(c.hex);row.querySelector('.color-name').textContent=c.name;scheduleBuild(false)});root.appendChild(row)});$('addColor').disabled=colors.length>=5;$('colorWarning').hidden=colors.length<5;updateSummary()}
function releaseFlowerMeshes(){if(activeFlowerMeshes.length){try{engine.release(activeFlowerMeshes)}catch(e){debug('error','Failed to release flower meshes',e)}activeFlowerMeshes=[]}}
function releaseBacking(){if(backingMesh){group.remove(backingMesh);if(backingMesh.geometry)backingMesh.geometry.dispose();if(backingMesh.material)backingMesh.material.dispose();backingMesh=null}}
function releaseBorder(){for(const id of Object.keys(borderFrameMeshes)){const m=borderFrameMeshes[id];if(!m)continue;group.remove(m);if(m.geometry)m.geometry.dispose();if(m.material)m.material.dispose()}borderFrameMeshes={}}
 function releaseFlowerBorder(id){const arr=borderFlowerMeshes[id];if(arr&&arr.length){try{engine.release(arr)}catch(e){debug('error','Failed to release border '+id+' meshes',e)}delete borderFlowerMeshes[id]}}
 function releaseAllFlowerBorders(){for(const id of Object.keys(borderFlowerMeshes))releaseFlowerBorder(id)}
 function releaseGreeneryBorder(id){const arr=borderGreeneryMeshes[id];if(arr&&arr.length){try{greenEngine&&greenEngine.release(arr)}catch(e){debug('error','Failed to release greenery border '+id+' meshes',e)}delete borderGreeneryMeshes[id]}}
 function releaseAllGreeneryBorders(){for(const id of Object.keys(borderGreeneryMeshes))releaseGreeneryBorder(id)}
 function hashSeed(str){let h=0;str=String(str);for(let i=0;i<str.length;i++){h=(h*31+str.charCodeAt(i))>>>0}return h||1}
 function releaseGreenery(){if(greeneryMeshes.length){try{greenEngine&&greenEngine.release(greeneryMeshes)}catch(e){debug('error','Failed to release greenery meshes',e)}greeneryMeshes=[]}}
  // Greenery: instances are grouped per type so each model draws as one InstancedMesh.
  // Depth comes entirely from model.greeneryPositions (z interleaves with the flowers);
  // the group itself must stay at z=0 — any negative offset would sink greenery into the
  // opaque foam slab (foam spans z=-0.12..0) and hide it in mixed mode.
  function buildGreenery(s){
   releaseGreenery();
   if(!threeReady||!group||!greenEngine||s.designMode==='flowers')return {count:0,triangles:0,types:[]};
   if(!greeneryGroup){greeneryGroup=new THREE.Group();group.add(greeneryGroup);}
   greeneryGroup.position.z=0;
   const inst=model.greeneryPositions(s);
   if(!inst.length)return {count:0,triangles:0,types:[]};
   const byType={};
   for(const p of inst){(byType[p.type]=byType[p.type]||[]).push(p);}
   const active=model.greeneryActiveItems(s.greenery);
   let count=0,tri=0;const types=[];
   for(const type of Object.keys(byType)){
     const meta=model.GREENERY_META[type];
     const item=active.find(a=>a.type===type)||{colorVariation:0.3};
     let res;
     try{res=greenEngine.build({type,items:byType[type],color:meta?meta.color:'#4a7c3f',colorVariation:item.colorVariation!=null?item.colorVariation:0.3,showLeaves:item.showLeaves!==false});}
     catch(err){debug('error','Greenery geometry generation failed',{type},err);previewStatus('The "'+type+'" greenery model failed to build. Open diagnostics for details.',true,'error');throw err}
     for(let i=0;i<res.meshes.length;i++)greeneryGroup.add(res.meshes[i]);
     greeneryMeshes=greeneryMeshes.concat(res.meshes);
     count+=res.instances;tri+=res.triangles;types.push(type);
   }
   debug('info','Greenery built',{designMode:s.designMode,mode:s.greenery.mode,instances:count,triangles:tri,types});
   return {count,triangles:tri,types};
 }
 // Frame border layer: an extruded ring between its outerInset and innerInset bands.
  function buildFrame(s,layer,band){
   if(!layer||!layer.enabled||!threeReady||!group||!band)return;
   const W=s.width*.72,H=s.height*.72;
   const outerHW=W/2-band.outerInsetFt*.72,outerHH=H/2-band.outerInsetFt*.72;
   const innerHW=W/2-band.innerInsetFt*.72,innerHH=H/2-band.innerInsetFt*.72;
   if(innerHW<=.01||innerHH<=.01)return;
   const depth=(layer.depth/12)*.72;
   const outer=new THREE.Shape();
   outer.moveTo(-outerHW,-outerHH);outer.lineTo(outerHW,-outerHH);outer.lineTo(outerHW,outerHH);outer.lineTo(-outerHW,outerHH);outer.closePath();
   const hole=new THREE.Path();
   hole.moveTo(-innerHW,-innerHH);hole.lineTo(innerHW,-innerHH);hole.lineTo(innerHW,innerHH);hole.lineTo(-innerHW,innerHH);hole.closePath();
   outer.holes.push(hole);
   const geo=new THREE.ExtrudeGeometry(outer,{depth,bevelEnabled:false});
   const mat=new THREE.MeshStandardMaterial({color:new THREE.Color(layer.color).convertSRGBToLinear(),roughness:.55,metalness:.08});
   const mesh=new THREE.Mesh(geo,mat);
   mesh.position.z=.006; // just above foam top (z=0) to avoid z-fighting
   mesh.userData.layerId=layer.id;
   group.add(mesh);
   borderFrameMeshes[layer.id]=mesh;
   debug('info','Frame border built',{id:layer.id,widthIn:layer.width,color:layer.color});
  }
  // Rebuild only one frame layer (colour/width change): everything else untouched.
  function rebuildFrameBorder(id){
   if(!threeReady||!group)return;
   const old=borderFrameMeshes[id];
   if(old){group.remove(old);if(old.geometry)old.geometry.dispose();if(old.material)old.material.dispose();delete borderFrameMeshes[id]}
   const s=settings(),layer=model.findBorderLayer(s,id);
   if(!layer||!layer.enabled||layer.type!=='frame')return;
   const band=model.borderBands(s).bands.find(b=>b.id===id);
   buildFrame(s,layer,band);
   if(renderer)renderer.render(scene,camera);
  }
  // One flower border layer: hex grid clipped to its band, per-flower rotation + colours.
  function buildOneFlowerBorder(s,layer,mainHexes){
   if(!layer||!layer.enabled||layer.type!=='flower')return {count:0,triangles:0};
   const pos=model.borderPositions(s,layer.id);
   if(!pos.length)return {count:0,triangles:0};
   const palHex=model.borderEffectivePalette(s,layer.id,mainHexes);
   const palette=palHex.map(h=>new THREE.Color(h).convertSRGBToLinear());
   const cIdx=model.borderColorIndices(pos.length,palHex.length,layer.arrangement,s.seed);
   const rotMax=(layer.rotation||0)*Math.PI/180;
   const lh=hashSeed(layer.id);
   const flowers=pos.map((xy,j)=>{const r=seededRand((s.seed+10007*lh+j*2654435761)>>>0);return {x:xy[0],y:xy[1],seed:100000+j+lh*977,colorIndex:cIdx[j]||0,spin:rotMax?(r()*2-1)*rotMax:0}});
   const S=layer.flowerSize/12*.72;
   let result;
   try{result=engine.build({type:layer.flowerType,flowers,colors:palette,S,leaves:s.flowerLeaves})}
   catch(err){debug('error','Border flower build failed',{id:layer.id,type:layer.flowerType},err);previewStatus('Border "'+layer.flowerType+'" failed to build.',true,'error');throw err}
   borderFlowerMeshes[layer.id]=result.meshes;
   for(let i=0;i<result.meshes.length;i++)group.add(result.meshes[i]);
   debug('info','Flower border built',{id:layer.id,type:layer.flowerType,flowers:flowers.length,triangles:result.triangles});
   return {count:flowers.length,triangles:result.triangles};
  }
  // One greenery border layer: a band of leaves clipped to its ring (fans outward).
  function buildGreeneryBorder(s,layer){
   if(!layer||!layer.enabled||layer.type!=='greenery'||!threeReady||!group||!greenEngine)return {count:0,triangles:0};
   const inst=model.greeneryBorderPositions(s,layer.id);
   if(!inst.length)return {count:0,triangles:0};
   const meta=model.GREENERY_META[layer.species];
   let res;
   try{res=greenEngine.build({type:layer.species,items:inst,color:meta?meta.color:'#4a7c3f',colorVariation:layer.colorVariation!=null?layer.colorVariation:0.3});}
   catch(err){debug('error','Greenery border build failed',{id:layer.id,type:layer.species},err);previewStatus('Greenery border "'+layer.species+'" failed to build.',true,'error');throw err}
   borderGreeneryMeshes[layer.id]=res.meshes;
   for(let i=0;i<res.meshes.length;i++)group.add(res.meshes[i]);
   debug('info','Greenery border built',{id:layer.id,species:layer.species,instances:res.instances,triangles:res.triangles});
   return {count:res.instances,triangles:res.triangles};
  }
  // Rebuild only one flower border layer (colour-only change).
  function rebuildFlowerBorder(id){
   if(!threeReady||!group)return;
   releaseFlowerBorder(id);
   const s=settings(),layer=model.findBorderLayer(s,id);
   if(!layer||!layer.enabled)return;
   const mainHex=model.counts(s,model.positions(s).length).map(c=>c.hex);
   buildOneFlowerBorder(s,layer,mainHex);
   if(renderer)renderer.render(scene,camera);
  }
  function borderLabel(layer){return layer.type==='frame'?'Frame':layer.type==='greenery'?'Greenery border':'Flower border'}
  function fmtFt(ft){const inches=Math.round(ft*12),feet=Math.floor(inches/12),inn=inches%12;return feet+' ft '+inn+' in'}
  const FLOWER_TYPES_OPTS=[['rose','Rose'],['marigold','Marigold'],['chrysanthemum','Chrysanthemum'],['dahlia','Dahlia'],['gerbera','Gerbera']];
  const FLOWER_SIZE_OPTS=[2,3,4,5,6];
  const ARRANGEMENT_OPTS=[['continuous','Continuous'],['spaced','Spaced'],['alternating','Alternating colours'],['paired','Paired colours'],['mixed','Mixed colours']];
  // Render the dynamic border-layer list (outside -> inside). Each card wires itself.
  function renderBorderLayers(){
   const root=$('borderLayers');if(!root)return;
   if(!borderLayers.length){
    root.innerHTML='<div class="empty">No border layers yet. Add a frame or flower border below.</div>';
   } else {
     root.innerHTML=borderLayers.map((l,i)=>{
      const title=borderLabel(l)+' '+(i+1);
      const collapsed=borderCollapsed.has(l.id);
      const vis=(l.enabled&&!collapsed)?'':'hidden'; // controls show only when enabled + expanded
      const head=`<div class="bl-head">
        <span class="bl-name"><input class="bl-enabled" type="checkbox" ${l.enabled?'checked':''} aria-label="${title} enabled"><span class="bl-title">${title}</span></span>
        <div class="bl-actions">
          <button class="btn bl-collapse" type="button" aria-label="${collapsed?'Expand':'Collapse'} ${title}" aria-expanded="${!collapsed}">${collapsed?'▸':'▾'}</button>
          <button class="btn bl-up" type="button" aria-label="Move ${title} outward" ${i===0?'disabled':''}>↑</button>
          <button class="btn bl-down" type="button" aria-label="Move ${title} inward" ${i===borderLayers.length-1?'disabled':''}>↓</button>
          <button class="btn bl-remove" type="button" aria-label="Remove ${title}">×</button></div></div>`;
     let controls='';
     if(l.type==='frame'){
      controls=`<div class="bl-controls" ${vis}>
        <div class="field"><label>Frame width <strong class="bl-width-v">${l.width} in</strong></label><input class="bl-width" type="range" min="1" max="24" step="0.5" value="${l.width}"></div>
        <div class="field"><label>Frame depth <strong class="bl-depth-v">${l.depth} in</strong></label><input class="bl-depth" type="range" min="0.5" max="4" step="0.5" value="${l.depth}"></div>
        <div class="field"><label>Frame colour</label><div class="color-row"><input class="bl-color" type="color" value="${l.color}" aria-label="${title} colour"><div><div class="color-name bl-color-name">${nameForColor(l.color)}</div></div></div></div>
       </div>`;
      } else if(l.type==='greenery'){
       const gList=(greenEngine&&greenEngine.list?greenEngine.list():[{type:'monstera',label:'Monstera leaf'}]);
       const gOpts=gList.map(o=>`<option value="${o.type}" ${l.species===o.type?'selected':''}>${o.label}</option>`).join('');
       controls=`<div class="bl-controls" ${vis}>
         <div class="field"><label>Species</label><select class="bl-g-species">${gOpts}</select></div>
         <div class="field"><label>Band width <strong class="bl-width-v">${l.width} in</strong></label><input class="bl-width" type="range" min="1" max="12" step="0.5" value="${l.width}"></div>
         <div class="field"><label>Leaf size <strong class="bl-g-size-v">${Number(l.sizeScale).toFixed(1)}×</strong></label><input class="bl-g-size" type="range" min="0.4" max="2.5" step="0.1" value="${l.sizeScale}"></div>
         <div class="field"><label>Density <strong class="bl-g-density-v">${l.density}%</strong></label><input class="bl-g-density" type="range" min="10" max="100" step="5" value="${l.density}"></div>
         <div class="field"><label>Overlap <strong class="bl-g-overlap-v">${Number(l.overlap).toFixed(2)}</strong></label><input class="bl-g-overlap" type="range" min="0" max="1" step="0.05" value="${l.overlap}"></div>
         <div class="field"><label>Rotation variation <strong class="bl-g-rotation-v">${l.rotationVariation}°</strong></label><input class="bl-g-rotation" type="range" min="0" max="180" step="5" value="${l.rotationVariation}"></div>
         <div class="field"><label>Colour variation <strong class="bl-g-colorvar-v">${Number(l.colorVariation).toFixed(2)}</strong></label><input class="bl-g-colorvar" type="range" min="0" max="1" step="0.05" value="${l.colorVariation}"></div>
        </div>`;
      } else {
      const typeOpts=FLOWER_TYPES_OPTS.map(([v,t])=>`<option value="${v}" ${l.flowerType===v?'selected':''}>${t}</option>`).join('');
      const sizeOpts=FLOWER_SIZE_OPTS.map(v=>`<option value="${v}" ${Number(l.flowerSize)===v?'selected':''}>${v} in</option>`).join('');
      const arrOpts=ARRANGEMENT_OPTS.map(([v,t])=>`<option value="${v}" ${l.arrangement===v?'selected':''}>${t}</option>`).join('');
      controls=`<div class="bl-controls" ${vis}>
        <div class="field"><label>Flower</label><select class="bl-flowerType">${typeOpts}</select></div>
        <div class="field"><label>Head size</label><select class="bl-flowerSize">${sizeOpts}</select></div>
        <div class="field"><label>Band width <strong class="bl-width-v">${l.width} in</strong></label><input class="bl-width" type="range" min="1" max="12" step="0.5" value="${l.width}"></div>
        <div class="field"><label>Density <strong class="bl-density-v">${l.density}%</strong></label><input class="bl-density" type="range" min="10" max="100" step="5" value="${l.density}"></div>
        <div class="field"><label>Colour mode</label><select class="bl-colorMode"><option value="independent" ${l.colorMode==='independent'?'selected':''}>Independent</option><option value="palette" ${l.colorMode==='palette'?'selected':''}>Follow main palette</option></select></div>
        <div class="field"><label>Colour</label><div class="color-row"><input class="bl-color" type="color" value="${l.color}" aria-label="${title} colour"><div><div class="color-name bl-color-name">${nameForColor(l.color)}</div></div></div></div>
        <div class="field"><label>Arrangement</label><select class="bl-arrangement">${arrOpts}</select></div>
        <div class="field"><label>Rotation <strong class="bl-rotation-v">${l.rotation}°</strong></label><input class="bl-rotation" type="range" min="0" max="180" step="5" value="${l.rotation}"></div>
       </div>`;
     }
     return `<div class="border-layer" data-id="${l.id}" data-i="${i}">${head}${controls}</div>`;
    }).join('');
    root.querySelectorAll('.border-layer').forEach(card=>wireBorderLayerCard(card));
   }
   syncBorderUI();
  }
  function wireBorderLayerCard(card){
   const id=card.dataset.id,i=Number(card.dataset.i);const l=borderLayers.find(x=>x.id===id);if(!l)return;
   card.querySelector('.bl-enabled').addEventListener('change',e=>{l.enabled=e.target.checked;renderBorderLayers();scheduleBuild(false)});
   card.querySelector('.bl-remove').addEventListener('click',()=>{borderLayers=borderLayers.filter(x=>x.id!==id);renderBorderLayers();scheduleBuild(false)});
   card.querySelector('.bl-up').addEventListener('click',()=>{if(i<=0)return;const t=borderLayers[i-1];borderLayers[i-1]=borderLayers[i];borderLayers[i]=t;renderBorderLayers();scheduleBuild(false)});
   card.querySelector('.bl-down').addEventListener('click',()=>{if(i>=borderLayers.length-1)return;const t=borderLayers[i+1];borderLayers[i+1]=borderLayers[i];borderLayers[i]=t;renderBorderLayers();scheduleBuild(false)});
   card.querySelector('.bl-collapse').addEventListener('click',()=>{if(borderCollapsed.has(id))borderCollapsed.delete(id);else borderCollapsed.add(id);renderBorderLayers()});
   const on=(sel,ev,fn)=>{const el=card.querySelector(sel);if(el)el.addEventListener(ev,fn)};
   const w=card.querySelector('.bl-width');
   if(w)w.addEventListener('input',e=>{const v=Number(e.target.value);l.width=v;const lab=card.querySelector('.bl-width-v');if(lab)lab.textContent=v+' in';if(l.type==='frame')rebuildFrameBorder(id);else scheduleBuild(false)});
   on('.bl-depth','input',e=>{const v=Number(e.target.value);l.depth=v;const lab=card.querySelector('.bl-depth-v');if(lab)lab.textContent=v+' in';rebuildFrameBorder(id)});
   on('.bl-color','input',e=>{l.color=e.target.value;const nm=card.querySelector('.bl-color-name');if(nm)nm.textContent=nameForColor(l.color);if(l.type==='frame')rebuildFrameBorder(id);else rebuildFlowerBorder(id)});
   on('.bl-flowerType','change',e=>{l.flowerType=e.target.value;scheduleBuild(false)});
   on('.bl-flowerSize','change',e=>{l.flowerSize=Number(e.target.value);scheduleBuild(false)});
   on('.bl-density','input',e=>{const v=Number(e.target.value);l.density=v;const lab=card.querySelector('.bl-density-v');if(lab)lab.textContent=v+'%';scheduleBuild(false)});
   on('.bl-colorMode','change',e=>{l.colorMode=e.target.value;scheduleBuild(false)});
   on('.bl-arrangement','change',e=>{l.arrangement=e.target.value;scheduleBuild(false)});
   on('.bl-rotation','input',e=>{const v=Number(e.target.value);l.rotation=v;const lab=card.querySelector('.bl-rotation-v');if(lab)lab.textContent=v+'°';scheduleBuild(false)});
   on('.bl-g-species','change',e=>{l.species=e.target.value;scheduleBuild(false)});
   on('.bl-g-size','input',e=>{const v=Number(e.target.value);l.sizeScale=v;const lab=card.querySelector('.bl-g-size-v');if(lab)lab.textContent=v.toFixed(1)+'×';scheduleBuild(false)});
   on('.bl-g-density','input',e=>{const v=Number(e.target.value);l.density=v;const lab=card.querySelector('.bl-g-density-v');if(lab)lab.textContent=v+'%';scheduleBuild(false)});
   on('.bl-g-overlap','input',e=>{const v=Number(e.target.value);l.overlap=v;const lab=card.querySelector('.bl-g-overlap-v');if(lab)lab.textContent=v.toFixed(2);scheduleBuild(false)});
   on('.bl-g-rotation','input',e=>{const v=Number(e.target.value);l.rotationVariation=v;const lab=card.querySelector('.bl-g-rotation-v');if(lab)lab.textContent=v+'°';scheduleBuild(false)});
   on('.bl-g-colorvar','input',e=>{const v=Number(e.target.value);l.colorVariation=v;const lab=card.querySelector('.bl-g-colorvar-v');if(lab)lab.textContent=v.toFixed(2);scheduleBuild(false)});
  }
  // Border Designer UI: add-layer controls + inner-area summary.
  function syncBorderUI(){
   const s=settings();
   const addBtn=$('borderAdd');if(addBtn)addBtn.disabled=borderLayers.length>=model.BORDER_MAX_LAYERS;
   const warn=$('borderMaxWarning');if(warn)warn.hidden=borderLayers.length<model.BORDER_MAX_LAYERS;
   const sum=$('borderSummary');
   if(sum){
    const enabled=borderLayers.filter(l=>l.enabled);
    if(enabled.length){
      const area=model.innerArea(s),tb=model.borderBands(s);
      const totalIn=Math.round(tb.totalInsetFt*12);
      sum.innerHTML=`Outer panel: ${s.width} ft × ${s.height} ft<br>Combined border: ${totalIn} in per side<br>Inner floral area: ${fmtFt(area.width)} × ${fmtFt(area.height)}`;
      sum.hidden=false;
    }else{sum.hidden=true}
   }
  }
  // Write normalized layers back to the UI shadow + re-render (used by applySettings).
  function applyBorderLayers(border){
   borderLayers=(border&&Array.isArray(border.layers))?border.layers.map(l=>({...l})):[]; 
   renderBorderLayers();
  }
 // ---- Greenery Designer UI ----
 function populateGreeneryTypes(){
  const opts=(greenEngine&&greenEngine.list?greenEngine.list():[{type:'monstera',label:'Monstera leaf'}]);
  const sel=$('greeneryType');if(sel)sel.innerHTML=opts.map(o=>`<option value="${o.type}">${o.label}</option>`).join('');
  return opts;
 }
 // Segmented controls are radio groups backed by hidden inputs (designMode, greeneryMode,
 // greeneryDirection) so the model schema and settings()/readGreenery() stay unchanged.
 function syncRadioGroup(name,value){document.querySelectorAll('input[name="'+name+'"]').forEach(r=>{r.checked=r.value===value})}
 function readRadioGroup(name){const el=document.querySelector('input[name="'+name+'"]:checked');return el?el.value:null}
 // Write a normalized greenery object back to the shared controls + the items shadow.
 function applyGreenery(g){
  g=g||{};
  greeneryItems=(Array.isArray(g.items)&&g.items.length)?g.items.map(it=>({...it})):defaultGreeneryItems();
  const set=(id,v)=>{const el=$(id);if(el&&v!=null)el.value=String(v)};
  const mode=g.mode||'mixed';
  set('greeneryMode',mode);syncRadioGroup('greeneryModeSeg',mode);
  const dir=g.direction||'mixed';
  set('greeneryDirection',dir);syncRadioGroup('greeneryDirectionSeg',dir);
  set('greeneryOverlap',g.overlap!=null?g.overlap:0.5);
  set('greeneryRotation',g.rotationVariation!=null?g.rotationVariation:60);
  set('greenerySeed',g.seed!=null?g.seed:1);
  syncGreeneryFields();
 }
  // Two independent checkboxes (Flowers on + Greenery on) drive the composite design mode.
  // Both off is not a valid design, so Flowers is forced back on. Composition style only
  // appears when both are on (mixed). Greenery controls show whenever greenery is on.
  function syncDesignModeUI(){
   const fEl=$('flowersOn'),gEl=$('greeneryOn');
   let fOn=fEl?fEl.checked:true, gOn=gEl?gEl.checked:false;
   if(!fOn&&!gOn){if(fEl)fEl.checked=true;fOn=true;}
   const dm=fOn&&gOn?'mixed':fOn?'flowers':'greenery';
   if($('designMode'))$('designMode').value=dm;
   const body=$('greeneryBody');if(body)body.hidden=!gOn;
   const cw=$('compositionWrap');if(cw)cw.hidden=dm!=='mixed';
   updateCompositionNote();
  }
  const COMPOSITION_NOTES={
   'greenery-base':'Greenery base: a full foliage layer behind a uniform flower wall.',
   'foliage-clusters':'Foliage clusters + flowers: greenery forms organic clusters and flowers nest within and around them — a foliage-led look.',
   'flower-dominant':'Flower-dominant: a dense flower wall with sparser greenery filling the gaps behind it.'
  };
  function updateCompositionNote(){
   const note=$('compositionNote');if(!note)return;
   const v=$('composition')?$('composition').value:'greenery-base';
   note.textContent=COMPOSITION_NOTES[v]||COMPOSITION_NOTES['greenery-base'];
  }
 // Show either the single-item controls or the mixed item list, and refresh value labels.
 function syncGreeneryFields(){
  syncDesignModeUI();
  const mode=($('greeneryMode')&&$('greeneryMode').value)||'mixed';
  const single=$('greenerySingle'),mixed=$('greeneryMixed');
  if(single)single.hidden=mode!=='single';
  if(mixed)mixed.hidden=mode!=='mixed';
  const ov=$('greeneryOverlapValue'),ovEl=$('greeneryOverlap');if(ov&&ovEl)ov.textContent=Number(ovEl.value).toFixed(2);
  const rv=$('greeneryRotationValue'),rvEl=$('greeneryRotation');if(rv&&rvEl)rv.textContent=rvEl.value+'°';
  if(mode==='single')syncSingleGreeneryControls();else renderGreeneryItems();
  updateGreeneryMaxWarning();
  syncFullnessUI();
 }
 function syncSingleGreeneryControls(){
  const it=greeneryItems[0]||defaultGreeneryItems()[0];
  const ts=$('greeneryType');if(ts)ts.value=it.type;
  const sz=$('greenerySize');if(sz)sz.value=it.sizeScale;
  const sv=$('greenerySizeValue');if(sv)sv.textContent=Number(it.sizeScale).toFixed(1)+'×';
 }
 // ---- Fullness: ONE density control (slider + presets stay in sync) ----
 // Presets are explicit values; any other slider position shows "Custom". Moving the slider
 // or a preset sets EVERY species' density to the same value (explicit, never a hidden count
 // change). Opening Advanced does not touch density and does not regenerate.
 const FULLNESS_PRESETS=[30,60,85,100];
 function currentFullness(){
  if(!greeneryItems.length)return 70;
  const d=Number(greeneryItems[0].density);
  return isFinite(d)?d:70;
 }
 function applyFullness(v){
  v=Math.max(10,Math.min(100,Math.round(v/5)*5));
  greeneryItems.forEach(it=>{it.density=v});
  syncFullnessUI();
  scheduleBuild(false);
 }
 function syncFullnessUI(){
  const v=currentFullness();
  const sl=$('greeneryFullness');if(sl)sl.value=String(v);
  const lab=$('greeneryFullnessValue');
  if(lab)lab.textContent=FULLNESS_PRESETS.includes(v)?v+'%':v+'% · Custom';
  document.querySelectorAll('[data-fullness-preset]').forEach(btn=>{
   btn.classList.toggle('active',Number(btn.getAttribute('data-fullness-preset'))===v);
  });
 }
 function renderGreeneryItems(){
  const root=$('greeneryItems');if(!root)return;
  const layerOpts=model.GREENERY_LAYERS.map(l=>`<option value="${l}">${l.charAt(0).toUpperCase()+l.slice(1)}</option>`).join('');
  const typeOpts=(greenEngine&&greenEngine.list?greenEngine.list():[]).map(o=>`<option value="${o.type}">${o.label}</option>`).join('');
  const supports=t=>{const sp=greenEngine&&greenEngine.get?greenEngine.get(t):null;return !!(sp&&sp.supportsLeaves)};
  const supportsColor=t=>{const sp=greenEngine&&greenEngine.get?greenEngine.get(t):null;return !!(sp&&sp.supportsColor)};
  const defaultColor=t=>{const m=model.GREENERY_META[t];return(m&&m.color)||'#ee9ec4'};
  root.innerHTML=greeneryItems.map((it,i)=>`
   <div class="greenery-item" data-i="${i}">
    <div class="greenery-item-head">
      <input class="gi-enabled" type="checkbox" ${it.enabled?'checked':''} aria-label="Enable greenery item ${i+1}">
      <select class="gi-type" aria-label="Greenery item ${i+1} type">${typeOpts}</select>
      <button class="btn gi-view" type="button" aria-label="Preview greenery item ${i+1}">View</button>
      <button class="btn gi-remove" type="button" aria-label="Remove greenery item ${i+1}">×</button>
    </div>
    <div class="field"><label>Proportion <strong class="gi-proportion-v">${it.proportion}%</strong></label><input class="gi-proportion" type="range" min="1" max="100" value="${it.proportion}"></div>
    <div class="field"><label>Size <strong class="gi-size-v">${Number(it.sizeScale).toFixed(1)}×</strong></label><input class="gi-size" type="range" min="0.4" max="2.5" step="0.1" value="${it.sizeScale}"></div>
    <div class="field"><label>Layer</label><select class="gi-layer">${layerOpts}</select></div>
    <div class="field"><label>Colour variation <strong class="gi-colorvar-v">${Number(it.colorVariation).toFixed(2)}</strong></label><input class="gi-colorvar" type="range" min="0" max="1" step="0.05" value="${it.colorVariation}"></div>
    <div class="field gi-color-wrap"${supportsColor(it.type)?'':' hidden'}><label>Blossom colour</label><input class="gi-color" type="color" value="${it.color||defaultColor(it.type)}"></div>
    <div class="field gi-leaves-wrap"${supports(it.type)?'':' hidden'}><label class="check-label"><input class="gi-leaves" type="checkbox" ${it.showLeaves!==false?'checked':''}> Show leaves <small>vines only</small></label></div>
    </div>`).join('');
  root.querySelectorAll('.greenery-item').forEach(row=>{
    const i=Number(row.dataset.i),it=greeneryItems[i];if(!it)return;
    row.querySelector('.gi-type').value=it.type;
    row.querySelector('.gi-layer').value=it.layer;
    const bind=(sel,valSel,fmt,apply)=>{const el=row.querySelector(sel);if(!el)return;el.addEventListener('input',e=>{const v=Number(e.target.value);apply(v);const vl=row.querySelector(valSel);if(vl)vl.textContent=fmt(v);scheduleBuild(false)})};
    row.querySelector('.gi-enabled').addEventListener('change',e=>{it.enabled=e.target.checked;scheduleBuild(false)});
    row.querySelector('.gi-type').addEventListener('change',e=>{it.type=e.target.value;const w=row.querySelector('.gi-leaves-wrap');if(w)w.hidden=!supports(it.type);const cw=row.querySelector('.gi-color-wrap');if(cw)cw.hidden=!supportsColor(it.type);if(!supportsColor(it.type))it.color=null;const ci=row.querySelector('.gi-color');if(ci&&cw&&!cw.hidden)ci.value=it.color||defaultColor(it.type);scheduleBuild(false)});
    row.querySelector('.gi-remove').addEventListener('click',()=>{if(greeneryItems.length<=1)return;greeneryItems.splice(i,1);renderGreeneryItems();updateGreeneryMaxWarning();scheduleBuild(false)});
    row.querySelector('.gi-view').addEventListener('click',()=>openGreeneryView(row.querySelector('.gi-type').value||it.type));
    bind('.gi-proportion','.gi-proportion-v',v=>v+'%',v=>it.proportion=v);
    bind('.gi-size','.gi-size-v',v=>v.toFixed(1)+'×',v=>it.sizeScale=v);
    row.querySelector('.gi-layer').addEventListener('change',e=>{it.layer=e.target.value;scheduleBuild(false)});
    bind('.gi-colorvar','.gi-colorvar-v',v=>v.toFixed(2),v=>it.colorVariation=v);
    const leaves=row.querySelector('.gi-leaves');
    if(leaves)leaves.addEventListener('change',e=>{it.showLeaves=e.target.checked;scheduleBuild(false)});
    const col=row.querySelector('.gi-color');
    if(col)col.addEventListener('input',e=>{it.color=e.target.value;scheduleBuild(false)});
  });
 }
 function updateGreeneryMaxWarning(){const w=$('greeneryMaxWarning'),add=$('greeneryAdd');if(add)add.disabled=greeneryItems.length>=model.GREENERY_MAX_ITEMS;if(w)w.hidden=greeneryItems.length<model.GREENERY_MAX_ITEMS}
 function fitCamera(){
  if(!camera||!controls)return;
  const s=settings(),max=Math.max(s.width,s.height)*.72;
  camera.position.set(0,max*.17,max*1.46+.55);controls.target.set(0,0,0);controls.update();
 }
function buildScene(refit=false){
 try {
 updateSummary();if(!threeReady||!group){debug('info','Scene build deferred: 3D renderer is not ready');return;}
 releaseFlowerMeshes();releaseBacking();releaseBorder();releaseAllFlowerBorders();releaseAllGreeneryBorders();releaseGreenery();
 const s=settings(),W=s.width*.72,H=s.height*.72,foamDepth=(2/12)*.72;
 const showFlowers=s.designMode!=='greenery';
 // The foam is a real shallow slab; its top face sits at z=0, directly under the flower heads.
 backingMesh=new THREE.Mesh(new THREE.BoxGeometry(W,H,foamDepth),new THREE.MeshStandardMaterial({color:new THREE.Color(0x84977b).convertSRGBToLinear(),roughness:1}));
 backingMesh.position.z=-foamDepth/2;group.add(backingMesh);
  const allPositions=model.positions(s),counts=model.counts(s,allPositions.length);
  // Colour arrangement is chosen by the Pattern engine (proportions always preserved).
  const assign=model.assignColors(s,allPositions);
  const colorIndex=assign.colorIndex;
  updatePatternNote(s,assign,allPositions.length);
  const flowers=allPositions.map((xy,i)=>({x:xy[0],y:xy[1],seed:i,colorIndex:colorIndex[i]||0}));
 const palette=counts.map(c=>new THREE.Color(c.hex).convertSRGBToLinear());
 const S=s.flowerSize/12*.72; // nominal head diameter in world units
 let result;const t0=performance.now();
 if(showFlowers){
  try{
   result=engine.build({type:s.flowerType,flowers,colors:palette,S,leaves:s.flowerLeaves});
  }catch(err){
   debug('error','Flower geometry generation failed',{type:s.flowerType,flowerDiameterIn:s.flowerSize,coverage:s.coverage,flowers:flowers.length},err);
   previewStatus('The "'+s.flowerType+'" flower model failed to build. Open diagnostics for details.',true,'error');
   throw err;
  }
  activeFlowerMeshes=result.meshes;
  for(let i=0;i<activeFlowerMeshes.length;i++)group.add(activeFlowerMeshes[i]);
 }else{
  result={meshes:[],triangles:0,petalsPerFlower:0};
  activeFlowerMeshes=[];
 }
  // Border layers (outside -> inside). mainHexes lets palette-mode flower borders reuse
  // the main palette. Borders are their OWN system, independent of the Flowers/Greenery
  // toggles: each layer renders on its own `enabled` flag. So a greenery border shows even
  // in a flowers-only design, and a flower border shows even in a greenery-only design.
  const mainHexes=counts.map(c=>c.hex);
  const bandsById={};for(const bd of model.borderBands(s).bands)bandsById[bd.id]=bd;
  let borderFlowerTotal=0,borderGreeneryTotal=0,fbTriangles=0,gbTriangles=0,frameCount=0;
  for(const layer of s.border.layers){
   if(!layer.enabled)continue;
   if(layer.type==='frame'){buildFrame(s,layer,bandsById[layer.id]);frameCount++;}
   else if(layer.type==='greenery'){const res=buildGreeneryBorder(s,layer);borderGreeneryTotal+=res.count;gbTriangles+=res.triangles;}
   else if(layer.type==='flower'){const res=buildOneFlowerBorder(s,layer,mainHexes);borderFlowerTotal+=res.count;fbTriangles+=res.triangles;}
  }
 const gre=buildGreenery(s);
 if(refit)fitCamera();
 const totalFlowers=allPositions.length+borderFlowerTotal;
 const shownFlowers=showFlowers?totalFlowers:0;
 const greeneryShown=gre.count+borderGreeneryTotal;
 const tri=result.triangles+fbTriangles+gbTriangles+gre.triangles;
 const slow=tri>7.2e6?' · high detail may run slowly on this device':'';
 // Viewer keeps user-facing text; triangle/draw-call stats go to diagnostics only (BUG-10).
 const statusText=s.designMode==='greenery'?`${greeneryShown.toLocaleString()} greenery pieces · ${s.width}×${s.height} ft panel${slow}`:s.designMode==='mixed'?`${shownFlowers.toLocaleString()} flowers + ${greeneryShown.toLocaleString()} greenery · ${s.width}×${s.height} ft panel${slow}`:`${shownFlowers.toLocaleString()} flowers · ${s.width}×${s.height} ft panel${slow}`;
 previewStatus(statusText,true);
 const borderMeshList=Object.keys(borderFlowerMeshes).flatMap(k=>borderFlowerMeshes[k]).concat(Object.keys(borderFrameMeshes).map(k=>borderFrameMeshes[k]),Object.keys(borderGreeneryMeshes).flatMap(k=>borderGreeneryMeshes[k]));
 const geoSet=new Set(),matSet=new Set();for(const m of activeFlowerMeshes.concat(borderMeshList,greeneryMeshes)){if(m.geometry)geoSet.add(m.geometry);if(m.material)matSet.add(m.material)}
 const buildMs=Math.round(performance.now()-t0);
 debug('info','Scene built',{designMode:s.designMode,species:s.flowerType,widthFt:s.width,heightFt:s.height,flowerDiameterIn:s.flowerSize,coverage:s.coverage,pattern:s.pattern,patternSeed:s.seed,patternSatisfied:assign.satisfied,flowers:showFlowers?allPositions.length:0,borderFlowers:borderFlowerTotal,borderGreeneryPieces:borderGreeneryTotal,frameLayers:frameCount,totalFlowers:shownFlowers,greeneryPieces:greeneryShown,greeneryTypes:gre.types,petalsPerFlower:result.petalsPerFlower,triangles:tri,instancedMeshes:activeFlowerMeshes.length+borderMeshList.length+greeneryMeshes.length,uniqueGeometries:geoSet.size,uniqueMaterials:matSet.size,buildMs,drawCalls:renderer&&renderer.info?renderer.info.render.calls:undefined,borderLayers:s.border.layers.map(l=>({id:l.id,type:l.type,enabled:l.enabled})),palette:counts.map(c=>({name:c.name,hex:c.hex,count:c.count}))});
 } catch(e) { debug('error','Scene build failed',e); previewStatus('Scene build failed. Open diagnostics for details.',true,'error'); throw e; }
}
// Coalesce rapid slider/colour changes into one rebuild so dragging stays smooth on mobile.
let buildTimer=null;
function scheduleBuild(refit=false){
 updateSummary();
 if(buildTimer)clearTimeout(buildTimer);
 buildTimer=setTimeout(()=>{buildTimer=null;buildScene(refit)},150);
}
function init3d(){debug('info','Initializing 3D renderer',{threePresent:!!window.THREE,orbitControlsPresent:!!(window.THREE&&THREE.OrbitControls),devicePixelRatio:window.devicePixelRatio});if(!window.THREE||!THREE.OrbitControls){debug('error','Three.js or OrbitControls failed to load');previewStatus('3D library did not load. Check internet and reload.',true,'error');$('canvas').innerHTML='<div class="fallback">3D preview could not load. Your controls and arrangement saving should still work.</div>';return}
try{scene=new THREE.Scene();scene.background=new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--scene-bg').trim()||'#e0e3da').convertSRGBToLinear();camera=new THREE.PerspectiveCamera(40,1,.1,200);renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.outputEncoding=THREE.sRGBEncoding;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=0.92;renderer.shadowMap.enabled=false;$('canvas').appendChild(renderer.domElement);renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();debug('error','WebGL context lost');previewStatus('Graphics context lost. Try reloading the preview.',true,'error')});renderer.domElement.addEventListener('webglcontextrestored',()=>{debug('warn','WebGL context restored; reload the preview if it remains blank');previewStatus('Graphics context restored. Reload if preview stays blank.',true,'warn')});controls=new THREE.OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.07;scene.add(new THREE.HemisphereLight(0xffffff,0x8c9584,0.72));const light=new THREE.DirectionalLight(0xffffff,1.12);light.position.set(8,12,15);scene.add(light);group=new THREE.Group();scene.add(group);
const resize=()=>{const w=$('canvas').clientWidth||500,h=$('canvas').clientHeight||500;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h)};resize();if(window.ResizeObserver){resizeObserver=new ResizeObserver(resize);resizeObserver.observe($('canvas'))}window.addEventListener('resize',resize);threeReady=true;debug('info','3D renderer initialized',{threeRevision:THREE.REVISION,canvasWidth:$('canvas').clientWidth,canvasHeight:$('canvas').clientHeight});buildScene(true);(function animate(){requestAnimationFrame(animate);if(controls)controls.update();if(renderer&&scene&&camera)renderer.render(scene,camera)})();previewStatus('3D preview ready',false)}catch(e){debug('error','3D initialization failed',e);console.error(e);previewStatus('3D preview failed. Open diagnostics for details.',true,'error')}}
function persist(){try{localStorage.setItem(STORE,JSON.stringify(saved));debug('info','Saved arrangements persisted',{count:saved.length});if(FLOWERS_CHANNEL)try{FLOWERS_CHANNEL.postMessage({type:'saved',count:saved.length})}catch{}}catch(e){debug('error','Browser storage write failed',e);status('Browser storage unavailable. Export JSON for backup.',true)}}
function sanitizeSaved(raw){if(!Array.isArray(raw))return[];return raw.filter(x=>x&&x.id&&x.settings&&typeof x.settings==='object').map(x=>({id:String(x.id),settings:model.normalize(x.settings),updatedAt:x.updatedAt||new Date().toISOString()}))}
function renderSaved(){try{const root=$('savedList');root.innerHTML='';if(!saved.length){root.innerHTML='<div class="empty">No saved arrangements yet.<br><small>Arrangements from a studio on another port do not carry over automatically (browsers isolate storage per address). Open it, choose Export JSON from the menu, then Import JSON here.</small></div>';return}saved.forEach(item=>{const el=document.createElement('div');el.className='saved-item';const info=document.createElement('div');const title=document.createElement('strong');title.textContent=item.settings.name;const meta=document.createElement('small');const nColors=item.settings.colors.length;meta.textContent=`${item.settings.width} × ${item.settings.height} ft · ${nColors} color${nColors===1?'':'s'}`;info.append(title,meta);const actions=document.createElement('div');actions.className='saved-actions';const load=document.createElement('button');load.className='btn';load.textContent='Load';load.onclick=()=>{currentId=item.id;applySettings(item.settings);currentName=$('arrangementName').value.trim();status('Arrangement loaded.')};const del=document.createElement('button');del.className='btn';del.textContent='×';del.setAttribute('aria-label','Delete '+item.settings.name);del.onclick=()=>{saved=saved.filter(x=>x.id!==item.id);persist();renderSaved();status('Saved arrangement deleted.')};actions.append(load,del);el.append(info,actions);root.appendChild(el)})}catch(e){debug('error','Could not render saved list',e);$('savedList').innerHTML='<div class="empty">Saved list could not be displayed.</div>'}}
function loadSaved(){try{const data=JSON.parse(localStorage.getItem(STORE)||'[]');saved=sanitizeSaved(data);debug('info','Saved arrangements loaded',{count:saved.length})}catch(e){saved=[];debug('warn','Could not read saved arrangements; starting with an empty list',e)}renderSaved()}
 // Most recently modified saved arrangement (by updatedAt), or null when none exist.
 function latestArrangement(){if(!saved.length)return null;let best=saved[0];for(const item of saved){if(String(item.updatedAt||'')>String(best.updatedAt||''))best=item}return best}
 // Reopen the latest arrangement on startup so reloading continues where the user left off.
 function restoreLatest(){const item=latestArrangement();if(!item){applySettings(defaults());currentId=null;currentName=null;return false}currentId=item.id;applySettings(item.settings);currentName=$('arrangementName').value.trim();return true}
// ---- saved colour palettes ------------------------------------------------
// Palettes store only the colour set (not the whole arrangement). "Use" swaps the
// current colours and rebuilds, leaving dimensions, pattern and proportions alone.
const PAL_STORE='flower-panel-palettes-v1';
let palettes=[];
function sanitizePalettes(data){if(!Array.isArray(data))return[];return data.slice(0,50).filter(p=>p&&Array.isArray(p.colors)&&p.colors.length>=1&&p.colors.length<=5).map((p,i)=>({id:String(p.id||('pal-'+i+'-'+Math.random().toString(36).slice(2,7))),name:String(p.name||'Palette '+(i+1)).slice(0,60),colors:p.colors.map(c=>({name:String(c.name||''),hex:model.cleanHex(String(c.hex||'#ffffff'))}))})).filter(p=>p.colors.every(c=>/^#[0-9a-f]{6}$/i.test(c.hex)))}
function persistPalettes(){try{localStorage.setItem(PAL_STORE,JSON.stringify(palettes));debug('info','Palettes persisted',{count:palettes.length})}catch(e){debug('warn','Palettes could not be saved',e)}}
function renderPalettes(){try{const root=$('paletteList');if(!root)return;root.innerHTML='';if(!palettes.length){root.innerHTML='<div class="empty">No saved palettes yet.</div>';return}palettes.forEach(p=>{const el=document.createElement('div');el.className='saved-item';const info=document.createElement('div');const title=document.createElement('strong');title.textContent=p.name;const meta=document.createElement('small');meta.textContent=p.colors.map(c=>c.name||c.hex.toUpperCase()).join(' · ');info.append(title,meta);const actions=document.createElement('div');actions.className='saved-actions';const use=document.createElement('button');use.className='btn';use.textContent='Use';use.onclick=()=>{colors=p.colors.map((c,i)=>({id:i+1,name:c.name||nameForColor(c.hex),hex:c.hex}));nextColorId=colors.length+1;renderColors();scheduleBuild(false);status('Palette "'+p.name+'" applied.')};const del=document.createElement('button');del.className='btn';del.textContent='×';del.setAttribute('aria-label','Delete palette '+p.name);del.onclick=()=>{palettes=palettes.filter(x=>x.id!==p.id);persistPalettes();renderPalettes();status('Palette deleted.')};actions.append(use,del);el.append(info,actions);root.appendChild(el)})}catch(e){debug('error','Could not render palettes',e)}}
function savePalette(){const name=(prompt('Palette name:',$('arrangementName').value.trim()||('Palette '+(palettes.length+1)))||'').trim();if(!name)return;const entry={id:'pal-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),name:name.slice(0,60),colors:colors.map(c=>({name:c.name,hex:c.hex}))};palettes=palettes.filter(x=>x.name!==entry.name);palettes.unshift(entry);if(palettes.length>50)palettes.length=50;persistPalettes();renderPalettes();status('Palette "'+entry.name+'" saved.')}
function loadPalettes(){try{palettes=sanitizePalettes(JSON.parse(localStorage.getItem(PAL_STORE)||'[]'));debug('info','Palettes loaded',{count:palettes.length})}catch(e){palettes=[];debug('warn','Could not read saved palettes; starting with an empty list',e)}renderPalettes()}
 function applySettings(raw){const s=model.normalize(raw);$('arrangementName').value=s.name==='Untitled arrangement'?'':s.name;$('width').value=s.width;$('height').value=s.height;$('flowerSize').value=s.flowerSize;if($('flowerType')){$('flowerType').value=s.flowerType;syncFlowerPicker()}$('coverage').value=s.coverage;$('pattern').value=s.pattern;$('mixIntensity').value=s.mixIntensity;$('groupingLimit').value=s.groupingLimit;$('clusterSize').value=s.clusterSize;$('patternDirection').value=s.patternDirection;if($('seed'))$('seed').value=String(s.seed);if($('flowersOn'))$('flowersOn').checked=s.flowersOn;if($('flowerLeaves'))$('flowerLeaves').checked=!!s.flowerLeaves;if($('greeneryOn'))$('greeneryOn').checked=s.greeneryOn;if($('composition'))$('composition').value=s.composition||'greenery-base';syncRadioGroup('compositionSeg',$('composition')?$('composition').value:'greenery-base');if($('designMode')){$('designMode').value=s.designMode}applyGreenery(s.greenery);applyBorderLayers(s.border);syncBorderUI();syncPatternFields();colors=s.colors;nextColorId=Math.max(1,...colors.map(c=>c.id))+1;renderColors();buildScene(true)}
function saveCurrent(){const s=settings();const name=$('arrangementName').value.trim();if(!name){status('Enter an arrangement name before saving.',true);$('arrangementName').focus();return}
 // Renaming a loaded arrangement always saves as a NEW arrangement; an unchanged name
 // updates the existing one in place (BUG: previously a rename silently overwrote the original).
 const reuse=currentId&&name===currentName;
 const id=reuse?currentId:('arr-'+Date.now()+'-'+Math.random().toString(36).slice(2,7));
 const idx=saved.findIndex(x=>x.id===id),entry={id,settings:s,updatedAt:new Date().toISOString()};
 if(idx>=0)saved[idx]=entry;else saved.unshift(entry);
 currentId=id;currentName=name;persist();renderSaved();status(reuse?'Arrangement updated.':'Arrangement saved as a new arrangement.')}
function newArrangement(){currentId=null;currentName=null;applySettings(defaults());$('arrangementName').value='';status('New arrangement started.')}
function setTheme(theme){document.documentElement.dataset.theme=theme;try{localStorage.setItem(THEME,theme)}catch(e){debug('warn','Theme preference could not be saved',e)}debug('info','Theme changed',{theme});$('themeToggle').textContent=theme==='dark'?'☀️ Light':'🌙 Dark';$('themeToggle').setAttribute('aria-pressed',String(theme==='dark'));if(scene){scene.background=new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--scene-bg').trim()||'#e0e3da').convertSRGBToLinear();if(renderer)renderer.render(scene,camera)}}
function exportData(){const data={schema:'flower-panel-studio-v2',exportedAt:new Date().toISOString(),savedArrangements:saved,current:settings()};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='flower-panel-arrangements.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('JSON backup exported.')}
function wire(){['width','height','flowerSize','coverage','mixIntensity','groupingLimit','clusterSize','patternDirection'].forEach(id=>$(id).addEventListener('input',()=>scheduleBuild(false)));if($('pattern'))$('pattern').addEventListener('change',()=>{syncPatternFields();scheduleBuild(false)});if($('generateNewPattern'))$('generateNewPattern').onclick=generateNewPattern;if($('flowerType'))$('flowerType').addEventListener('change',()=>scheduleBuild(false));if($('flowerLeaves'))$('flowerLeaves').addEventListener('change',()=>scheduleBuild(false));$('arrangementName').addEventListener('input',updateSummary);$('addColor').onclick=()=>{if(colors.length>=5)return;const presets=['#ffc0cb','#d8efcf','#ffd166','#ff0000'];const hex=presets[(colors.length-1)%presets.length];colors.push({id:nextColorId++,name:nameForColor(hex),hex});renderColors();scheduleBuild(false)};$('whiteReset').onclick=()=>{colors=[{id:1,name:'White',hex:'#ffffff'}];nextColorId=2;renderColors();scheduleBuild(false);status('Palette reset to white.')};if($('savePalette'))$('savePalette').onclick=()=>{debug('info','Save palette requested');savePalette()};// Border Designer wiring: full rebuild on structure changes, targeted on colour-only.
  // Border Designer wiring: add-layer button. Per-layer cards wire themselves in
  // renderBorderLayers (re-rendered on every structural change).
  if($('borderAdd'))$('borderAdd').onclick=()=>{
   if(borderLayers.length>=model.BORDER_MAX_LAYERS)return;
   const type=($('borderAddType')&&$('borderAddType').value)||'flower';
   const layer=type==='frame'?defaultFrameBorder():type==='greenery'?defaultGreeneryBorder():defaultFlowerBorder();
   layer.id='bd'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
   borderLayers.push(layer);
   renderBorderLayers();scheduleBuild(false);
  };
  // Greenery Designer wiring. Segmented controls drive hidden inputs so settings() and
  // readGreenery() keep reading the same model paths. Advanced (details) opens without
  // regenerating — only value changes rebuild.
  // Flowers/Greenery master toggles + composition style. Both on = mixed; the composition
  // selector only matters then. Each toggle drives the composite mode via syncDesignModeUI.
  const onMasterToggle=()=>{syncGreeneryFields();scheduleBuild(false)};
  if($('flowersOn'))$('flowersOn').addEventListener('change',onMasterToggle);
  if($('greeneryOn'))$('greeneryOn').addEventListener('change',onMasterToggle);
  document.querySelectorAll('input[name="compositionSeg"]').forEach(r=>r.addEventListener('change',()=>{
    if($('composition'))$('composition').value=r.value;updateCompositionNote();scheduleBuild(false)}));
  document.querySelectorAll('input[name="greeneryModeSeg"]').forEach(r=>r.addEventListener('change',()=>{
    if($('greeneryMode'))$('greeneryMode').value=r.value;syncGreeneryFields();scheduleBuild(false)}));
  document.querySelectorAll('input[name="greeneryDirectionSeg"]').forEach(r=>r.addEventListener('change',()=>{
    if($('greeneryDirection'))$('greeneryDirection').value=r.value;scheduleBuild(false)}));
  const ovEl=$('greeneryOverlap');if(ovEl)ovEl.addEventListener('input',()=>{const l=$('greeneryOverlapValue');if(l)l.textContent=Number(ovEl.value).toFixed(2);scheduleBuild(false)});
  const rvEl=$('greeneryRotation');if(rvEl)rvEl.addEventListener('input',()=>{const l=$('greeneryRotationValue');if(l)l.textContent=rvEl.value+'°';scheduleBuild(false)});
  if($('greeneryType'))$('greeneryType').addEventListener('change',e=>{if(!greeneryItems[0])return;greeneryItems[0].type=e.target.value;scheduleBuild(false)});
  if($('greenerySize'))$('greenerySize').addEventListener('input',e=>{if(!greeneryItems[0])return;const v=Number(e.target.value);greeneryItems[0].sizeScale=v;const l=$('greenerySizeValue');if(l)l.textContent=v.toFixed(1)+'×';scheduleBuild(false)});
  if($('greeneryAdd'))$('greeneryAdd').onclick=()=>{if(greeneryItems.length>=model.GREENERY_MAX_ITEMS)return;greeneryItems.push({type:'monstera',enabled:true,sizeScale:1,density:currentFullness(),proportion:Math.round(100/(greeneryItems.length+1)),layer:'volume',colorVariation:0.3});renderGreeneryItems();updateGreeneryMaxWarning();scheduleBuild(false)};
  if($('greeneryGenerate'))$('greeneryGenerate').onclick=()=>{const seed=Math.floor(Math.random()*1e9)>>>0;if($('greenerySeed'))$('greenerySeed').value=String(seed);scheduleBuild(false);status('Generated a new arrangement (seed '+seed+').')};
  // Fullness: slider + presets write the SAME density to every species (explicit, never a
  // hidden count change). Preset chips stay in sync with the slider via syncFullnessUI().
  const fnEl=$('greeneryFullness');if(fnEl)fnEl.addEventListener('input',()=>applyFullness(Number(fnEl.value)));
  document.querySelectorAll('[data-fullness-preset]').forEach(btn=>{
   btn.addEventListener('click',()=>applyFullness(Number(btn.getAttribute('data-fullness-preset'))));
  });
 $('saveArrangement').onclick=()=>{debug('info','Save arrangement requested');saveCurrent()};$('newArrangement').onclick=()=>{debug('info','New arrangement requested');newArrangement()};$('fitView').onclick=fitCamera;$('themeToggle').onclick=()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');$('backToScene').onclick=()=>{const p=new URLSearchParams(location.search).get('p');location.href='../'+(p?'?p='+encodeURIComponent(p):'')};$('export').onclick=()=>{debug('info','Export JSON requested');exportData()};$('importButton').onclick=()=>{debug('info','Import JSON picker opened');$('importFile').click()};$('importFile').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{const data=JSON.parse(await f.text());if(!['flower-panel-studio-v2','flower-panel-designer-mvp-v1'].includes(data.schema))throw Error('Unsupported backup file.');saved=sanitizeSaved(data.savedArrangements).slice(0,100);persist();renderSaved();if(data.current)applySettings(data.current);status('Backup imported.')}catch(err){debug('error','JSON import failed',err);status(err.message||'Could not import JSON.',true)}e.target.value=''}}
function populateFlowerTypes(){const list=$('flowerPickerList');if(!list)return;const types=engine&&engine.list?engine.list():[];const items=types.length?types:[{type:'rose',label:'Rose'}];list.innerHTML=items.map(t=>`<li class="picker-item" role="option" tabindex="0" data-type="${t.type}"><span>${t.label}</span></li>`).join('');list.querySelectorAll('.picker-item').forEach(li=>{const choose=()=>selectFlowerType(li.dataset.type);li.addEventListener('click',choose);li.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose()}})});syncFlowerPicker()}
function syncFlowerPicker(){const type=($('flowerType')&&$('flowerType').value)||'rose';const sp=engine&&engine.get?engine.get(type):null;const lbl=$('flowerPickerLabel');if(lbl)lbl.textContent=sp?sp.label:type;const list=$('flowerPickerList');if(list)list.querySelectorAll('.picker-item').forEach(li=>{const on=li.dataset.type===type;li.classList.toggle('active',on);li.setAttribute('aria-selected',String(on))})}
function setPickerOpen(open){const btn=$('flowerPickerBtn'),list=$('flowerPickerList');if(btn)btn.setAttribute('aria-expanded',String(open));if(list)list.hidden=!open}
function selectFlowerType(type){if($('flowerType'))$('flowerType').value=type;syncFlowerPicker();setPickerOpen(false);scheduleBuild(false)}
function wireFlowerPicker(){const btn=$('flowerPickerBtn');if(btn)btn.onclick=e=>{e.stopPropagation();const list=$('flowerPickerList');setPickerOpen(!!(list&&list.hidden))};document.addEventListener('click',e=>{if(!e.target.closest||!e.target.closest('#flowerPicker'))setPickerOpen(false)})}

// ---- pattern & distribution ----
// Show only the sub-settings relevant to the selected pattern.
function syncPatternFields(){const p=($('pattern')&&$('pattern').value)||'nongrouping';document.querySelectorAll('.builder-body [data-pattern]').forEach(el=>{const show=el.dataset.pattern.split(',').map(x=>x.trim()).indexOf(p)>=0;el.hidden=!show})}
// Honest reporting when a grouping limit cannot be fully met on a thinned lattice.
function updatePatternNote(s,assign,n){const note=$('patternNote');if(!note)return;if(s.pattern==='nongrouping'&&!assign.satisfied&&assign.unsatisfied>0){note.textContent=assign.unsatisfied.toLocaleString()+' of '+n.toLocaleString()+' flowers still touch a same-colour neighbour at this setting.';note.hidden=false}else{note.hidden=true;note.textContent=''}}
// New seed -> new arrangement, everything else (dimensions, type, palette, proportions) preserved.
function generateNewPattern(){const seed=Math.floor(Math.random()*1e9)>>>0;if($('seed'))$('seed').value=String(seed);scheduleBuild(false);status('Generated a new pattern (seed '+seed+').')}

// ---- element 3D preview modal (own renderer; disposed on close) --------------
// Shared by the Flowers "View" button and the Greenery "View" buttons. One modal, one
// renderer at a time; the releaser is stored per-view so flowers free via engine.release
// and greenery frees via greenEngine.release.
let view3d=null;
function openFlowerView(){const type=($('flowerType')&&$('flowerType').value)||'rose';const sp=engine&&engine.get?engine.get(type):null;openElementView('flower',type,sp?sp.label:type)}
function openGreeneryView(type){const t=type||($('greeneryType')&&$('greeneryType').value)||model.GREENERY_TYPES[0];const meta=model.GREENERY_META?model.GREENERY_META[t]:null;openElementView('greenery',t,(meta&&meta.label)||t)}
function openElementView(kind,value,label){const t=$('viewTitle');if(t)t.textContent=label||value;const m=$('viewModal');if(m)m.hidden=false;buildElementView(kind,value)}
function closeFlowerView(){const m=$('viewModal');if(m)m.hidden=true;disposeElementView()}
function buildElementView(kind,value){
  disposeElementView();if(!window.THREE)return;const host=$('viewCanvas');if(!host)return;host.innerHTML='';
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.outputEncoding=THREE.sRGBEncoding;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=0.92;host.appendChild(renderer.domElement);
  const bg=getComputedStyle(document.documentElement).getPropertyValue('--scene-bg').trim()||'#e0e3da';const scene=new THREE.Scene();scene.background=new THREE.Color(bg).convertSRGBToLinear();
  const camera=new THREE.PerspectiveCamera(40,1,0.1,100);camera.position.set(0,0.45,2.4);
  scene.add(new THREE.HemisphereLight(0xffffff,0x8c9584,0.72));const dl=new THREE.DirectionalLight(0xffffff,1.12);dl.position.set(3,4,5);scene.add(dl);
  let meshes=[],releaseFn=null;
  if(kind==='greenery'){
    // Single leaf/spray/bush at the origin, recentred using the species' XY bounds so the
    // whole element is framed regardless of where its stem-base origin sits.
    const meta=model.GREENERY_META&&model.GREENERY_META[value];
    const item={key:0,type:value,layer:meta?meta.defaultLayer:'structural',x:0,y:0,z:0,rot:0,scale:1,variant:0.5,seed:1};
    try{
      const res=greenEngine.build({type:value,items:[item],color:meta?meta.color:'#4a7c3f',colorVariation:0.3});
      meshes=res.meshes||[];
      if(meta&&meta.bounds){const[ax,ay,bx,by]=meta.bounds,cx=(ax+bx)/2,cy=(ay+by)/2;meshes.forEach(mm=>mm.position.set(-cx,-cy,0))}
      meshes.forEach(mm=>scene.add(mm));
    }catch(e){debug('error','Greenery view build failed',{type:value},e)}
    releaseFn=m=>{try{greenEngine&&greenEngine.release(m)}catch(_){}};
  }else{
    const pal=colors&&colors[0]?colors[0].hex:'#ffffff';const previewColors=[new THREE.Color(pal).convertSRGBToLinear()];
    try{const res=engine.build({type:value,flowers:[{x:0,y:0,seed:1,colorIndex:0}],colors:previewColors,S:1.0});meshes=res.meshes||[];meshes.forEach(mm=>scene.add(mm))}catch(e){debug('error','Flower view build failed',e)}
    releaseFn=m=>{try{engine.release(m)}catch(_){}};
  }
  const controls=window.THREE.OrbitControls?new THREE.OrbitControls(camera,renderer.domElement):null;if(controls){controls.enableDamping=true;controls.dampingFactor=.08;controls.minDistance=1.2;controls.maxDistance=5}
  const resize=()=>{const w=host.clientWidth||320,h=host.clientHeight||320;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h)};resize();
  let raf=0;const animate=()=>{raf=requestAnimationFrame(animate);if(controls)controls.update();renderer.render(scene,camera)};animate();
  view3d={renderer,scene,camera,controls,meshes,host,raf,resize,release:releaseFn};
  debug('info','Element view opened',{kind,type:value});
}
function disposeElementView(){if(!view3d)return;const{renderer,scene,camera,controls,meshes,host,raf,release}=view3d;cancelAnimationFrame(raf);try{release&&release(meshes)}catch(_){}if(controls&&controls.dispose)controls.dispose();if(renderer){renderer.dispose();if(renderer.domElement&&renderer.domElement.parentNode)renderer.domElement.parentNode.removeChild(renderer.domElement)}if(host)host.innerHTML='';view3d=null}
function wireBuilderToggle(){const b=$('builder');if(!b)return;const app=document.querySelector('.app'),head=b.querySelector('.sidehead');
 const toggle=source=>{const collapsed=b.classList.toggle('collapsed');if(app)app.classList.toggle('builder-collapsed',collapsed);debug('info','Arrangement builder '+(collapsed?'collapsed':'expanded')+' ('+source+')')};
 // Title/chip tap toggles; the theme button inside it must not.
 if(head)head.onclick=e=>{if(e.target.closest&&e.target.closest('#themeToggle'))return;toggle('title tap')};
 // Viewer tap (small movement, short hold) toggles; a drag orbits instead.
 const el=renderer&&renderer.domElement;if(el){let sx=0,sy=0,st=0;el.addEventListener('pointerdown',e=>{sx=e.clientX;sy=e.clientY;st=Date.now()});el.addEventListener('pointerup',e=>{const dx=e.clientX-sx,dy=e.clientY-sy,dt=Date.now()-st;if(dx*dx+dy*dy<64&&dt<700)toggle('viewer tap')})}}
function wireSectionChips(){const chips=[...document.querySelectorAll('.chip-bar .chip')],sections=[...document.querySelectorAll('.builder-body .section[data-section]')];if(!chips.length)return;
 const select=id=>{chips.forEach(c=>{const on=c.dataset.section===id;c.classList.toggle('active',on);c.setAttribute('aria-selected',String(on))});sections.forEach(s=>s.hidden=s.dataset.section!==id);debug('info','Section chip selected',{section:id})};
 chips.forEach(c=>c.onclick=()=>select(c.dataset.section));}
function wireMenu(){const btn=$('menuToggle'),menu=$('overflowMenu');if(!btn||!menu)return;
 const setOpen=open=>{menu.hidden=!open;btn.setAttribute('aria-expanded',String(open))};
 btn.onclick=e=>{e.stopPropagation();setOpen(menu.hidden)};
 // Close after choosing an item. Container listener (not per-item onclick) so it never
 // overwrites the handlers diagnostics.js / wire() already attached to the items.
 menu.addEventListener('click',()=>setOpen(false));
 // Close when tapping outside the menu.
 document.addEventListener('click',e=>{if(!menu.hidden&&e.target.closest&&!e.target.closest('.menu-wrap'))setOpen(false)});}
function start(){debug('info','Application startup begins',{readyState:document.readyState});try{const theme=(()=>{try{return localStorage.getItem(THEME)==='dark'?'dark':'light'}catch(e){debug('warn','Local storage unavailable during startup',e);return 'light'}})();document.documentElement.dataset.theme=theme;wire();wireSectionChips();wireMenu();wireFlowerPicker();$('viewFlower')&&($('viewFlower').onclick=openFlowerView);$('viewGreenery')&&($('viewGreenery').onclick=()=>openGreeneryView());$('viewClose')&&($('viewClose').onclick=closeFlowerView);$('viewBackdrop')&&($('viewBackdrop').onclick=closeFlowerView);setTheme(theme);loadSaved();loadPalettes();populateFlowerTypes();populateGreeneryTypes();const restored=restoreLatest();debug('info',restored?'Restored latest saved arrangement on startup':'No saved arrangement; starting fresh',{currentId,currentName});init3d();wireBuilderToggle();debug('info','Application startup completed');}catch(e){debug('error','Application initialization failed',e);console.error(e);previewStatus('Application initialization error. Open diagnostics for details.',true,'error');if($('totalCount'))$('totalCount').textContent='—';status('Initialization failed: '+e.message,true)}}
document.addEventListener('DOMContentLoaded',start);
})();
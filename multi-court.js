(function(){
'use strict';
var el=id=>document.getElementById(id),video,overlay,ctx,model=null,source=null,stream=null,objectURL=null,active=false,busy=false,last=0,raf=0;
var ids=1,tracks=new Map(),logs=[],selected=null,teams=new Map(),frames=0;
var palette=['#f0d464','#65dbdf','#e88c78','#be96e5','#75d698','#e4b75b','#ec9bc1','#a6cdff','#bfd687','#feaf8a'];
var edges=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[28,30],[30,32]];
var status=(msg,bad=false)=>{el('courtStatus').textContent=msg;el('courtStatus').style.color=bad?'#f4a09c':'#badbc7'};
var color=id=>palette[(id-1)%palette.length];
function reset(){tracks.clear();logs=[];selected=null;ids=1;frames=0;teams.clear();cards();paint()}
function stop(){active=false;cancelAnimationFrame(raf);el('courtStart').disabled=false;el('courtStop').disabled=true}
function stopStream(){if(stream){stream.getTracks().forEach(x=>x.stop());stream=null}}
function clearSource(){stop();stopStream();if(objectURL){URL.revokeObjectURL(objectURL);objectURL=null}video.pause();video.removeAttribute('src');video.srcObject=null;video.load();source=null;reset();if(model){model.close();model=null}}
function rect(){let w=overlay.width,h=overlay.height,r=video.videoWidth/video.videoHeight;if(!isFinite(r))return [0,0,w,h];return r>w/h?[0,(h-w/r)/2,w,w/r]:[(w-h*r)/2,0,h*r,h]}
function paint(){
 var box=el('courtStage').getBoundingClientRect();if(!box.width)return;
 var k=Math.min(2,window.devicePixelRatio||1),w=Math.round(box.width*k),h=Math.round(box.height*k);
 if(overlay.width!==w||overlay.height!==h){overlay.width=w;overlay.height=h}
 ctx.clearRect(0,0,w,h);var [rx,ry,rw,rh]=rect(),X=x=>rx+x*rw,Y=y=>ry+y*rh;
 var now=performance.now();
 for(const t of tracks.values()){
  if(now-t.last>900)continue;
  var c=color(t.id);ctx.strokeStyle=c;ctx.lineWidth=selected===t.id?3.5:2;ctx.fillStyle=c;
  if(el('courtTrails').checked&&t.trail.length>1){ctx.save();ctx.globalAlpha=.6;ctx.beginPath();t.trail.forEach((p,i)=>{if(i)ctx.lineTo(X(p.x),Y(p.y));else ctx.moveTo(X(p.x),Y(p.y))});ctx.stroke();ctx.restore()}
  if(el('courtSkeleton').checked){ctx.save();ctx.globalAlpha=.82;for(const [a,b] of edges){let p=t.points[a],q=t.points[b];if(p&&q&&p.visibility>.45&&q.visibility>.45){ctx.beginPath();ctx.moveTo(X(p.x),Y(p.y));ctx.lineTo(X(q.x),Y(q.y));ctx.stroke()}}ctx.restore()}
  var [x1,y1,x2,y2]=t.box;ctx.strokeRect(X(x1),Y(y1),Math.max(3,(x2-x1)*rw),Math.max(3,(y2-y1)*rh));
  var label=(teams.get(t.id)||'TRACK')+' '+t.id;
  ctx.font='bold '+Math.round(13*k)+'px sans-serif';var tw=ctx.measureText(label).width+12;
  var lx=Math.max(0,Math.min(w-tw,X(x1))),ly=Math.max(22*k,Y(y1)-4);
  ctx.fillRect(lx,ly-19*k,tw,21*k);ctx.fillStyle='#07151b';ctx.fillText(label,lx+6,ly-4*k);
 }
}
function observation(points){
 let v=points.filter(p=>p&&p.visibility>.43&&isFinite(p.x)&&isFinite(p.y));if(v.length<8)return null;
 let minx=Math.min(...v.map(p=>p.x)),maxx=Math.max(...v.map(p=>p.x)),miny=Math.min(...v.map(p=>p.y)),maxy=Math.max(...v.map(p=>p.y));
 let hip=points[23]?.visibility>.35&&points[24]?.visibility>.35?{x:(points[23].x+points[24].x)/2,y:(points[23].y+points[24].y)/2}:null;
 return {points,box:[minx,miny,maxx,maxy],center:hip||{x:(minx+maxx)/2,y:(miny+maxy)/2},confidence:v.reduce((a,p)=>a+p.visibility,0)/v.length};
}
function associate(obs,now){
 let alive=[...tracks.values()].filter(t=>now-t.last<950),candidates=[],usedA=new Set(),usedB=new Set(),updated=[];
 for(let i=0;i<alive.length;i++)for(let j=0;j<obs.length;j++){
  let t=alive[i],o=obs[j],dt=Math.max(.05,Math.min(.8,(now-t.last)/1000)),dx=o.center.x-(t.center.x+t.vx*dt),dy=o.center.y-(t.center.y+t.vy*dt),d=Math.hypot(dx,dy),wid=t.box[2]-t.box[0];
  if(d<Math.max(.13,Math.min(.35,wid*.8+dt*.26)))candidates.push([d,i,j]);
 }
 candidates.sort((a,b)=>a[0]-b[0]);
 for(const [d,i,j] of candidates){
  if(usedA.has(i)||usedB.has(j))continue;
  let t=alive[i],o=obs[j],dt=Math.max(.05,(now-t.last)/1000),dx=o.center.x-t.center.x,dy=o.center.y-t.center.y;
  t.vx=.65*t.vx+.35*dx/dt;t.vy=.65*t.vy+.35*dy/dt;t.center=o.center;t.box=o.box;t.points=o.points;t.confidence=o.confidence;t.last=now;t.count++;t.path+=Math.hypot(dx,dy);
  t.trail.push(o.center);if(t.trail.length>65)t.trail.shift();usedA.add(i);usedB.add(j);updated.push(t);
 }
 for(let j=0;j<obs.length;j++)if(!usedB.has(j)){
  let o=obs[j],t={id:ids++,center:o.center,box:o.box,points:o.points,confidence:o.confidence,last:now,count:1,path:0,vx:0,vy:0,trail:[o.center]};
  tracks.set(t.id,t);updated.push(t);
 }
 if(logs.length<12000)logs.push({time:video.currentTime||0,timestamp_ms:Math.round(now),tracks:updated.map(t=>({id:t.id,x:+t.center.x.toFixed(4),y:+t.center.y.toFixed(4),confidence:+t.confidence.toFixed(2)}))});
 frames++;if(frames%3===0)cards();paint()
}
function cards(){
 let now=performance.now(),arr=[...tracks.values()].filter(t=>now-t.last<950).sort((a,b)=>a.id-b.id);
 el('courtVisibleCount').textContent=arr.length+' / '+el('courtMaxPoses').value;el('courtTotalTracks').textContent=ids-1;el('courtFrames').textContent=frames;
 let list=el('courtPlayerList');list.replaceChildren();
 if(!arr.length){let p=document.createElement('p');p.className='court-hint';p.textContent='No players currently detected. Select a video or camera and start.';list.append(p)}
 for(let t of arr){
  let b=document.createElement('button');b.type='button';b.className='court-player'+(selected===t.id?' selected':'');b.style.borderLeftColor=color(t.id);
  let name=document.createElement('strong');name.textContent='Track '+t.id+'  ·  '+(teams.get(t.id)||'Unassigned');
  let note=document.createElement('small');note.textContent='Observed frames: '+t.count+' · Last confidence: '+Math.round(t.confidence*100)+'%';
  b.append(name,note);b.onclick=()=>{selected=t.id;cards();paint()};list.append(b)
 }
 let chosen=tracks.get(selected),a=el('courtTeamAssign');a.disabled=!chosen;a.value=chosen?(teams.get(chosen.id)||''):'';
 el('courtTrackDetails').textContent=chosen?'Track '+chosen.id+' has '+chosen.count+' observed frames and '+chosen.path.toFixed(2)+' cumulative normalized image-units displacement. Not calibrated distance, speed or a verified identity.':'Select a track. Labels can switch after players cross, leave frame or overlap.';
}
async function loadModel(){
 if(model)return;
 status('Loading pose model into this browser. First use requires a download…');
 let M=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/+esm');
 let vision=await M.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm');
 model=await M.PoseLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',delegate:'CPU'},runningMode:'VIDEO',numPoses:Number(el('courtMaxPoses').value),minPoseDetectionConfidence:.45,minPosePresenceConfidence:.45,minTrackingConfidence:.45});
 status('Model ready. Processing is local; video is not uploaded.');
}
async function start(){
 if(!source)throw Error('Choose a video or camera.');
 if(active)return;el('courtStart').disabled=true;
 try{
  if(video.paused)await video.play();await loadModel();active=true;el('courtStop').disabled=false;last=0;
  let tick=()=>{
   if(!active)return;raf=requestAnimationFrame(tick);
   if(busy||video.paused||video.readyState<2)return;
   let now=performance.now();if(now-last<Number(el('courtSampleRate').value))return;last=now;busy=true;
   try{let result=model.detectForVideo(video,now);associate((result.landmarks||[]).map(observation).filter(Boolean),now)}
   catch(e){stop();status('Tracking stopped: '+e.message,true)}finally{busy=false}
  };tick();status('Tracking. IDs are anonymous estimates and may change when players overlap.');
 }catch(e){stop();throw e}
}
async function fileChange(file){
 clearSource();if(!file)return;
 if(!file.type.startsWith('video/')&&!/\.(mp4|mov|webm|m4v)$/i.test(file.name))throw Error('Choose MP4, MOV or WebM video.');
 if(file.size>1024*1024*1024)throw Error('Choose a video under 1 GB.');
 objectURL=URL.createObjectURL(file);video.src=objectURL;video.controls=true;video.muted=false;source=file.name;status('Loaded '+file.name+'. Press Start tracking.')
}
async function camera(){
 clearSource();
 if(!navigator.mediaDevices?.getUserMedia)throw Error('Live camera is not supported on this browser.');
 stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:1280},height:{ideal:720}},audio:false});
 video.srcObject=stream;video.controls=false;video.muted=true;video.playsInline=true;source='live camera';await video.play();status('Camera ready. Press Start tracking.')
}
function download(){
 if(!logs.length){status('No observations to export yet.');return}
 let payload={format:'laso-multi-person-v1',source,created_at:new Date().toISOString(),coordinate_units:'normalized image proportions; NOT real world distance',caveats:['IDs may swap at player crossing','No roster identity verification','No reliable absolute speed, force, court distance or possession'],teams:[...teams],frames:logs};
 let url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='laso-court-tracks.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);status('Private JSON downloaded. Footage was not uploaded.')
}
function setup(){
 if(video)return;video=el('courtVideo');overlay=el('courtOverlay');ctx=overlay.getContext('2d');
 el('courtFile').onchange=async e=>{try{await fileChange(e.target.files[0])}catch(x){status(x.message,true)}};
 el('courtCamera').onclick=()=>camera().catch(x=>status(x.message,true));
 el('courtStart').onclick=()=>start().catch(x=>status(x.message,true));
 el('courtStop').onclick=stop;
 el('courtReset').onclick=()=>{stop();reset();status('Tracking history cleared. Video retained.')};
 el('courtExport').onclick=download;
 el('courtMaxPoses').onchange=()=>{stop();if(model){model.close();model=null}reset();status('Pose capacity changed. Start again.')};
 el('courtTeamAssign').onchange=e=>{if(selected){if(e.target.value)teams.set(selected,e.target.value);else teams.delete(selected);cards();paint()}};
 el('courtTrails').onchange=paint;el('courtSkeleton').onchange=paint;
 video.onloadedmetadata=()=>{el('courtStage').style.aspectRatio=video.videoWidth+'/'+video.videoHeight;paint()};
 video.onended=()=>{stop();status('End of clip. Download observations or replay.')};
 window.addEventListener('resize',paint);
 status('Select a basketball video to track players locally.');
}
function deactivate(){stop();stopStream();if(source==='live camera'){video.pause();video.srcObject=null;source=null;status('Live camera stopped when leaving Court Lab.')}}
window.addEventListener('pagehide',deactivate);
window.LasoMultiCourt={setup,stop,deactivate,paint};
})();
/* LasO Court Lab — explicit, authenticated live share for AI-assisted review.
   Sends a small JPEG every ~7s plus anonymous pose locations; NO automatic sharing.
   Use only with permission from EVERY recorded participant.
*/
(function(){
'use strict';
const URL='https://elfmxffnkjfyshcyrvrb.supabase.co';
const KEY='sb_publishable_3dORQkwVHSWGrwGWQRrGWQ_A8EG4ABw';
const $=id=>document.getElementById(id);
const ST='laso_court_share_auth_v1';
let auth=null,share=null,pump=null,pending=false,frames=0,active=false;
const msg=s=>{const x=$('courtLiveStatus');if(x)x.textContent=s};
function api(path,opts={}){
 return fetch(URL+path,{...opts,headers:{apikey:KEY,'Content-Type':'application/json',...(auth?.access_token?{Authorization:'Bearer '+auth.access_token}:{}),...opts.headers}});
}
async function json(resp){
 let body={};try{body=await resp.json()}catch{}
 if(!resp.ok)throw Error(body.msg||body.message||body.error_description||body.error||'Request failed: '+resp.status);
 return body;
}
async function userSession(){
 if(!auth?.access_token)throw Error('Sign in with your LasO account first.');
 if(auth.expires_at&&Date.now()>auth.expires_at*1000-60000){
   const refresh=auth.refresh_token;
   if(!refresh)throw Error('Your account session has expired. Sign in again.');
   const r=await json(await api('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:refresh})}));
   auth={...r,expires_at:r.expires_at||Math.floor(Date.now()/1000)+r.expires_in};
   sessionStorage.setItem(ST,JSON.stringify(auth));
 }
 return auth.user?.id;
}
async function signIn(){
 const email=$('courtShareEmail').value.trim(),password=$('courtSharePassword').value;
 if(!email||!password){msg('Enter your existing LasO account email and password.');return}
 $('courtShareSignIn').disabled=true;try{
   const res=await json(await api('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})}));
   auth={...res,expires_at:res.expires_at||Math.floor(Date.now()/1000)+res.expires_in};
   sessionStorage.setItem(ST,JSON.stringify(auth));
   $('courtSharePassword').value='';
   showAccount();msg('Signed in as '+(auth.user?.email||'LasO user')+'. To share, confirm participant permission and press Start live share.');
 }catch(e){msg('Sign-in failed: '+e.message)}
 finally{$('courtShareSignIn').disabled=false}
}
function showAccount(){
 const good=!!auth?.user?.id;
 $('courtShareLogin').hidden=good;
 $('courtShareControls').hidden=!good;
 if(good)$('courtShareAccount').textContent=auth.user.email||'LasO account';
}
async function revokeShare(){
 if(!share)return;
 try{
   await userSession();
   await json(await api('/rest/v1/court_live_shares?id=eq.'+encodeURIComponent(share.id)+'&owner_id=eq.'+encodeURIComponent(auth.user.id),{
     method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({stopped_at:new Date().toISOString()})
   }));
 }catch(e){msg('Local sharing stopped, but the server stop could not be confirmed: '+e.message)}
}
function stopTimers(){active=false;clearInterval(pump);pump=null;$('courtShareStart').disabled=false;$('courtShareStop').disabled=true}
async function stopShare(){
 stopTimers();
 await revokeShare();
 share=null;
 $('courtShareCode').textContent='No active share';
 $('courtShareStarted').hidden=true;
 msg('Sharing stopped on this device. Previous temporary frames expire automatically.');
}
function captureFrame(video){
 if(!video||video.readyState<2||!video.videoWidth)return null;
 const factor=Math.min(1,380/video.videoWidth),w=Math.max(32,Math.round(video.videoWidth*factor)),h=Math.max(18,Math.round(video.videoHeight*factor));
 const can=document.createElement('canvas');can.width=w;can.height=h;
 can.getContext('2d').drawImage(video,0,0,w,h);
 let data=can.toDataURL('image/jpeg',.32).split(',')[1];
 if(data.length>82000){
   can.width=Math.max(32,Math.round(w*.73));can.height=Math.max(18,Math.round(h*.73));
   can.getContext('2d').drawImage(video,0,0,can.width,can.height);
   data=can.toDataURL('image/jpeg',.23).split(',')[1];
 }
 return data.length<=84000?{frame_jpeg_b64:data,frame_width:can.width,frame_height:can.height}:null;
}
async function sendSample(){
 if(!active||pending||!share)return;
 pending=true;
 try{
   const uid=await userSession(),sample=window.LasoMultiCourt?.getSnapshot?.();
   if(!sample?.running||!sample.video||sample.video.paused)return;
   if(Date.now()>Date.parse(share.expires_at)){stopTimers();msg('Live share expired after 45 minutes. Start a new share if needed.');return}
   const image=captureFrame(sample.video);
   if(!image){msg('Unable to capture a temporary frame; check whether the camera is playing.');return}
   const row={share_id:share.id,owner_id:uid,player_count:sample.tracks.length,tracks:sample.tracks,
     video_seconds:sample.source==='live camera'?null:sample.video.currentTime,expires_at:new Date(Date.now()+10*60000).toISOString(),...image};
   await json(await api('/rest/v1/court_live_samples',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(row)}));
   frames++;
   msg('LIVE · '+frames+' frames shared · '+sample.tracks.length+' players tracked · last sent '+new Date().toLocaleTimeString()+'. Show ChatGPT your share code to review these frames.');
 }catch(e){msg('Cannot send frame: '+e.message+'. Sharing will stop unless access is restored.');stopTimers()}
 finally{pending=false}
}
async function startShare(){
 if(active)return;
 if(!$('courtShareConsent').checked){msg('Confirm you have permission from all people being filmed before sharing.');return}
 if(!window.LasoMultiCourt?.getSnapshot?.()?.running){msg('Start basketball player tracking first, then enable live sharing.');return}
 $('courtShareStart').disabled=true;
 try{
   const uid=await userSession();
   const code=crypto.randomUUID();
   const insert={owner_id:uid,code,expires_at:new Date(Date.now()+45*60000).toISOString(),consent_confirmed:true,source_label:'basketball_court_lab'};
   const result=await json(await api('/rest/v1/court_live_shares',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(insert)}));
   if(!result?.[0]?.id)throw Error('The session was not created.');
   share=result[0];frames=0;active=true;
   $('courtShareCode').textContent=code;
   $('courtShareStarted').hidden=false;
   $('courtShareStop').disabled=false;
   msg('Live share started. Copy the code below and paste it into our ChatGPT conversation. The share expires after 45 minutes.');
   await sendSample();
   if(active)pump=setInterval(sendSample,7000);
 }catch(e){$('courtShareStart').disabled=false;msg('Unable to start live share: '+e.message)}
}
async function signOut(){
 if(active)await stopShare();
 auth=null;sessionStorage.removeItem(ST);showAccount();msg('Signed out of live sharing.');
}
function init(){
 if(!$('courtLivePanel'))return;
 $('courtShareSignIn').onclick=signIn;
 $('courtShareStart').onclick=startShare;
 $('courtShareStop').onclick=stopShare;
 $('courtShareSignOut').onclick=signOut;
 $('courtShareCopy').onclick=async()=>{
   if(!share)return;
   try{await navigator.clipboard.writeText(share.code);msg('Session code copied. Paste it into our ChatGPT conversation.')}catch{msg('Copy the displayed session code manually into ChatGPT.')}
 };
 try{
   const saved=sessionStorage.getItem(ST);
   if(saved){auth=JSON.parse(saved);if(!auth?.user?.id)auth=null}
 }catch{auth=null}
 showAccount();msg('Live sharing is OFF by default. Sign in and confirm recording permission to begin.');
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&active)msg('App is in the background. No background camera upload is supported; keep Court Lab open.')});
 window.addEventListener('pagehide',()=>{stopTimers()});
}
window.LasoCourtLiveShare={init,stopShare};
})();
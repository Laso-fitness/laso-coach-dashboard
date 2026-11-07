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
const GOOGLE_PKCE_KEY='laso-court-share-google-pkce-v1';
function b64(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
async function signInGoogle(){
 try{
   if(!crypto?.subtle)throw Error('Google sign-in needs a secure browser (Safari or Chrome).');
   const verifier=b64(crypto.getRandomValues(new Uint8Array(32)));
   const challenge=b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
   const returnTo=window.location.origin+'/court-lab.html';
   sessionStorage.setItem(GOOGLE_PKCE_KEY,JSON.stringify({verifier,returnTo,startedAt:Date.now()}));
   const params=new URLSearchParams({provider:'google',redirect_to:returnTo,code_challenge:challenge,code_challenge_method:'s256',prompt:'select_account'});
   msg('Opening Google sign-in. If Google returns an unauthorized redirect warning, the Court Lab return URL must be enabled in Supabase Auth.');
   window.location.assign(URL+'/auth/v1/authorize?'+params.toString());
 }catch(e){msg('Google sign-in could not start: '+e.message)}
}
async function receiveOAuth(){
 const search=new URLSearchParams(window.location.search),hash=new URLSearchParams(window.location.hash.replace(/^#/,''));
 if(!search.has('code')&&!search.has('error')&&!hash.has('error')&&!hash.has('access_token'))return;
 const removeParams=()=>{const u=new URL(window.location.href);for(const k of ['code','error','error_code','error_description'])u.searchParams.delete(k);u.hash='';window.history.replaceState(null,'',u.pathname+u.search)};
 if(search.has('error')||hash.has('error')){removeParams();msg('Google sign-in was canceled or unavailable; try again.');return}
 try{
   if(search.has('code')){
     let state=null;try{state=JSON.parse(sessionStorage.getItem(GOOGLE_PKCE_KEY)||'null')}catch{}
     const code=search.get('code');removeParams();
     if(!state?.verifier||state.returnTo!==window.location.origin+'/court-lab.html'||Date.now()-state.startedAt>15*60000)throw Error('This Google sign-in has expired or opened in another tab. Try again here.');
     const res=await json(await api('/auth/v1/token?grant_type=pkce',{method:'POST',body:JSON.stringify({auth_code:code,code_verifier:state.verifier})}));
     if(!res?.access_token||!res?.refresh_token||!res?.user?.id)throw Error('The account could not be verified.');
     auth={...res,expires_at:res.expires_at||Math.floor(Date.now()/1000)+res.expires_in};
   }else if(hash.has('access_token')){
     const access=hash.get('access_token'),refresh=hash.get('refresh_token'),seconds=Number(hash.get('expires_in'));removeParams();
     if(!access||!refresh||!Number.isFinite(seconds)||seconds<=0)throw Error('This sign-in link was incomplete.');
     const user=await json(await fetch(URL+'/auth/v1/user',{headers:{apikey:KEY,Authorization:'Bearer '+access}}));
     if(!user?.id)throw Error('The account could not be verified.');
     auth={user,access_token:access,refresh_token:refresh,expires_at:Math.floor(Date.now()/1000)+seconds};
   }
   sessionStorage.setItem(ST,JSON.stringify(auth));
   showAccount();msg('Google sign-in verified. Please confirm athlete permission before enabling any sharing.');
 }catch(e){msg('Google sign-in failed: '+e.message)}
 finally{sessionStorage.removeItem(GOOGLE_PKCE_KEY)}
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
function captureFrame(video,tracks){
 if(!video||video.readyState<2||!video.videoWidth)return null;
 const factor=Math.min(1,400/video.videoWidth),w=Math.max(32,Math.round(video.videoWidth*factor)),h=Math.max(18,Math.round(video.videoHeight*factor));
 const can=document.createElement('canvas');can.width=w;can.height=h;
 function draw(){
   const g=can.getContext('2d');g.drawImage(video,0,0,can.width,can.height);
   for(const t of tracks||[]){
     const x=t.x*can.width,y=t.y*can.height;
     if(!Number.isFinite(x)||!Number.isFinite(y))continue;
     g.beginPath();g.arc(x,y,Math.max(5,can.width*.014),0,2*Math.PI);
     g.strokeStyle='#ffe175';g.lineWidth=2.5;g.stroke();
     const label='P'+t.id;
     g.font='bold 13px system-ui';g.fillStyle='#ffe175';
     g.fillRect(x+5,y-22,27,19);g.fillStyle='#13201f';g.fillText(label,x+8,y-8);
   }
 }
 draw();
 let data=can.toDataURL('image/jpeg',.31).split(',')[1];
 if(data.length>82000){
   can.width=Math.max(32,Math.round(w*.72));can.height=Math.max(18,Math.round(h*.72));
   draw();
   data=can.toDataURL('image/jpeg',.21).split(',')[1];
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
   const image=captureFrame(sample.video,sample.tracks);
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
 $('courtShareGoogle').onclick=signInGoogle;
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
 showAccount();msg('Live sharing is OFF by default. Sign in and confirm recording permission to begin.');receiveOAuth();
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&active)msg('App is in the background. No background camera upload is supported; keep Court Lab open.')});
 window.addEventListener('pagehide',()=>{stopTimers()});
}
window.LasoCourtLiveShare={init,stopShare};
})();
const icons={globe:'◎',whatsapp:'◉',instagram:'◇',email:'@',phone:'☎',calendar:'▣',shop:'◆',link:'↗'};
const safeUrl=value=>{try{const u=new URL(value,location.origin);return ['http:','https:','mailto:','tel:'].includes(u.protocol)?u.href:'#'}catch{return '#'}};
async function init(){
 try{
  const res=await fetch('/api/link-hub',{cache:'no-store'});if(!res.ok)throw new Error('Could not load links');const data=await res.json();
  document.getElementById('hubName').textContent=data.profile.name;document.getElementById('hubTagline').textContent=data.profile.tagline;
  const logo=document.getElementById('hubLogo');logo.src=safeUrl(data.profile.logoUrl);logo.onerror=()=>logo.src='/assets/icss-logo.png';
  const list=document.getElementById('hubLinks');list.innerHTML='';
  data.links.filter(x=>x.enabled).forEach(x=>{const a=document.createElement('a');a.className='hub-link';a.href=safeUrl(x.url);a.target='_blank';a.rel='noopener';a.innerHTML=`<span class="link-icon">${icons[x.icon]||icons.link}</span><span class="link-copy"><strong></strong><small></small></span><span class="arrow">›</span>`;a.querySelector('strong').textContent=x.title;a.querySelector('small').textContent=x.subtitle||'';list.appendChild(a)});
  if(data.offer?.enabled){setTimeout(()=>showOffer(data.offer),650)}
 }catch(e){document.getElementById('hubLinks').innerHTML='<div class="loading">We could not load these links. Please try again shortly.</div>'}
}
function showOffer(o){['Eyebrow','Title','Description','Code'].forEach(k=>document.getElementById('offer'+k).textContent=o[k.toLowerCase()]||'');const wrap=document.getElementById('offerCodeWrap');wrap.hidden=!o.code;const btn=document.getElementById('offerButton');btn.textContent=o.buttonText||'Claim offer';btn.href=safeUrl(o.buttonUrl);document.getElementById('offerModal').hidden=false}
document.getElementById('closeOffer').onclick=()=>document.getElementById('offerModal').hidden=true;document.getElementById('offerModal').onclick=e=>{if(e.target===e.currentTarget)e.currentTarget.hidden=true};document.getElementById('copyCode').onclick=async()=>{await navigator.clipboard.writeText(document.getElementById('offerCode').textContent);document.getElementById('copyCode').textContent='Copied!'};document.addEventListener('keydown',e=>{if(e.key==='Escape')document.getElementById('offerModal').hidden=true});init();

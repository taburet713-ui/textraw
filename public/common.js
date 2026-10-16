const HEADER=`<header class="topbar"><a class="brand" href="index.html"><span class="brand-logo">T</span><span>TEXTRAW <i>ARCADE</i><small>PLAY · CREATE · SHARE</small></span></a><nav><a href="index.html">Главная</a><a href="games.html">Игры</a><a href="studio.html">Студия</a><a href="store.html">Магазин</a></nav><div class="topbar-actions"><button class="btn" id="accountButton">Аккаунт</button><button class="theme-toggle" id="themeToggle" title="Сменить тему">☼</button></div></header>`;
const FOOTER=`<footer><a class="brand footer-brand" href="index.html"><span class="brand-logo">T</span><span>TEXTRAW ARCADE<small>MADE FOR CREATORS</small></span></a><span>Игровой портал · Netlify Cloud</span><a href="#">Наверх ↑</a></footer>`;
document.querySelector('#appHeader')&&(document.querySelector('#appHeader').innerHTML=HEADER);
document.querySelector('#appFooter')&&(document.querySelector('#appFooter').innerHTML=FOOTER);
document.querySelector('#themeToggle')?.addEventListener('click',()=>{document.body.classList.toggle('light');localStorage.setItem('trTheme',document.body.classList.contains('light')?'light':'dark')});
if(localStorage.getItem('trTheme')==='light')document.body.classList.add('light');
function getJSON(k,fallback=[]){try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(fallback))}catch(e){return fallback}}
const privateStateKeys=new Set(['trProjects','trLogic','trVariables']);
const stateTimers={};
function putJSON(k,v){try{localStorage.setItem(k,JSON.stringify(v));if(privateStateKeys.has(k)&&window.TRCloud?.user){clearTimeout(stateTimers[k]);stateTimers[k]=setTimeout(()=>window.TRCloud.saveState(k,v).catch(e=>console.warn('Cloud save failed',e)),350)}return true}catch(e){alert('Не удалось сохранить данные. Возможно, хранилище браузера переполнено.');return false}}
function safeText(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function saveBlob(name,content,type='text/html'){const blob=new Blob([content],{type:type+';charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(name||'project').replace(/[^\wа-яё.-]+/gi,'_');a.click();setTimeout(()=>URL.revokeObjectURL(url),1500)}
function readFile(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=reject;r.readAsText(file)})}
function makeId(){return 'p'+Date.now().toString(36)+Math.random().toString(36).slice(2,7)}

const authMarkup=`<div class="modal" id="authModal"><div class="modal-shell auth-shell"><div class="modal-top"><div><label>TEXTRAW ACCOUNT</label><h2 id="authHeading">Вход в аккаунт</h2></div><button class="icon-close" id="authClose">✕</button></div><p class="muted">Аккаунт нужен для общих публикаций и синхронизации личных проектов. Используй уникальный пароль.</p><form id="authForm"><label class="field-label">Имя пользователя<input id="authUsername" autocomplete="username" minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+" required placeholder="Например, pixel_player"></label><label class="field-label">Пароль<input id="authPassword" type="password" autocomplete="current-password" minlength="8" maxlength="128" required placeholder="Не менее 8 символов"></label><p id="authStatus" class="muted" role="status"></p><button class="btn primary wide" id="authSubmit" type="submit">Войти</button></form><button class="text-link auth-switch" id="authSwitch" type="button">Нет аккаунта? Зарегистрироваться</button><button class="btn wide" id="authLogout" type="button" hidden>Выйти из аккаунта</button><p class="auth-small">Вход по имени пользователя и паролю, без Google. Восстановление пароля без почты не предусмотрено — сохрани пароль в надёжном месте.</p></div></div>`;
document.body.insertAdjacentHTML('beforeend',authMarkup);
const authModal=document.querySelector('#authModal'),authForm=document.querySelector('#authForm'),authStatus=document.querySelector('#authStatus'),authSwitch=document.querySelector('#authSwitch'),authLogout=document.querySelector('#authLogout'),authHeading=document.querySelector('#authHeading'),authSubmit=document.querySelector('#authSubmit');
let authMode='login';
function openAuth(){authModal.classList.add('open');authStatus.textContent='';document.querySelector('#authPassword').value='';authForm.hidden=!!window.TRCloud?.user;authSwitch.hidden=!!window.TRCloud?.user;authLogout.hidden=!window.TRCloud?.user;authHeading.textContent=window.TRCloud?.user?`Аккаунт: ${window.TRCloud.user.username}`:(authMode==='login'?'Вход в аккаунт':'Создать аккаунт');authSubmit.textContent=authMode==='login'?'Войти':'Зарегистрироваться';}
document.querySelector('#accountButton').onclick=openAuth;
document.querySelector('#authClose').onclick=()=>authModal.classList.remove('open');
authModal.addEventListener('click',e=>{if(e.target===authModal)authModal.classList.remove('open')});
authSwitch.onclick=()=>{authMode=authMode==='login'?'register':'login';authHeading.textContent=authMode==='login'?'Вход в аккаунт':'Создать аккаунт';authSubmit.textContent=authMode==='login'?'Войти':'Зарегистрироваться';authStatus.textContent='';document.querySelector('#authPassword').autocomplete=authMode==='login'?'current-password':'new-password';authSwitch.textContent=authMode==='login'?'Нет аккаунта? Зарегистрироваться':'Уже есть аккаунт? Войти'};

async function api(action,{method='GET',body}={}){
  const options={method,credentials:'same-origin',headers:{}};
  if(body!==undefined){options.headers['content-type']='application/json';options.body=JSON.stringify(body)}
  const response=await fetch(`/.netlify/functions/api?action=${encodeURIComponent(action)}`,options);
  const contentType=response.headers.get('content-type')||'';
  if(!contentType.includes('application/json'))throw new Error('Серверная функция не найдена. Проверь, что сайт опубликован вместе с Netlify Functions.')
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Ошибка запроса.');return data;
}
window.TRCloud={user:null,games:[],apps:[],api,
  async refreshGames(){const r=await api('games/list');this.games=r.games||[];return this.games},
  async refreshApps(){const r=await api('apps/list');this.apps=r.apps||[];return this.apps},
  async saveState(key,value){if(!this.user)return false;await api('state/save',{method:'POST',body:{key,value}});return true},
  async loadState(){if(!this.user)return;const r=await api('state/load');const remote=r.state||{};const migrate=sessionStorage.getItem('tr_migrate_local')==='1';for(const key of privateStateKeys){if(remote[key]!==null&&remote[key]!==undefined){localStorage.setItem(key,JSON.stringify(remote[key]))}else if(migrate){let value;try{value=JSON.parse(localStorage.getItem(key)||'null')}catch{}if(value!==null&&value!==undefined)await this.saveState(key,value)}else{const old=localStorage.getItem(key);if(old!==null)localStorage.setItem('tr_backup_before_cloud_'+key,old);localStorage.removeItem(key)}}if(migrate){for(const game of getJSON('trGames',[])){if(!game?.code)continue;try{await this.publishGame({name:game.name||'Импортированная игра',desc:game.desc||'',emoji:game.emoji||'🧩',code:game.code})}catch(e){console.warn('Old local game migration skipped',e.message)}}for(const app of getJSON('trApps',[])){if(!app?.content||!app?.fileName)continue;try{const bytes=new TextEncoder().encode(String(app.content));if(bytes.length>3500000)continue;let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));await api('apps/publish',{method:'POST',body:{name:app.name||app.fileName,desc:app.desc||'',author:this.user.username,fileName:app.fileName,fileBase64:btoa(binary),mimeType:'text/plain'}})}catch(e){console.warn('Old local app migration skipped',e.message)}}await this.refreshGames();await this.refreshApps()}sessionStorage.removeItem('tr_migrate_local')},
  async publishGame(game){const r=await api('games/publish',{method:'POST',body:game});await this.refreshGames();return r.game},
  async deleteGame(id){await api('games/delete',{method:'POST',body:{id}});await this.refreshGames()},
  async publishApp(file,metadata){if(file.size>3500000)throw new Error('Максимальный размер файла — 3,5 МБ.');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));const fileBase64=btoa(binary);const r=await api('apps/publish',{method:'POST',body:{...metadata,fileName:file.name,fileBase64,mimeType:file.type||'application/octet-stream'}});await this.refreshApps();return r.app},
  downloadUrl(id){return `/.netlify/functions/api?action=apps/download&id=${encodeURIComponent(id)}`}
};

async function initializeCloud(){
  try{const r=await api('auth/me');window.TRCloud.user=r.user||null;}catch(e){console.warn('TEXTRAW Cloud not ready:',e.message);window.TRCloud.user=null}
  if(window.TRCloud.user){localStorage.setItem('tr_last_cloud_user',window.TRCloud.user.username);try{await window.TRCloud.loadState()}catch(e){console.warn('Could not load private state:',e.message)}}else if(localStorage.getItem('tr_last_cloud_user')){for(const key of privateStateKeys){const old=localStorage.getItem(key);if(old!==null)localStorage.setItem('tr_backup_before_cloud_'+key,old);localStorage.removeItem(key)}localStorage.removeItem('tr_last_cloud_user')}
  try{await window.TRCloud.refreshGames()}catch(e){console.warn('Could not load public games:',e.message)}
  try{await window.TRCloud.refreshApps()}catch(e){console.warn('Could not load public apps:',e.message)}
  const button=document.querySelector('#accountButton');if(button)button.textContent=window.TRCloud.user?`👤 ${window.TRCloud.user.username}`:'Войти';
  return window.TRCloud;
}
window.TRCloud.ready=initializeCloud();

authForm.addEventListener('submit',async e=>{
  e.preventDefault();authSubmit.disabled=true;authStatus.textContent='Подключаемся к серверу…';
  try{const username=document.querySelector('#authUsername').value.trim(),password=document.querySelector('#authPassword').value;const r=await api(authMode==='login'?'auth/login':'auth/register',{method:'POST',body:{username,password}});window.TRCloud.user=r.user;if(authMode==='register')sessionStorage.setItem('tr_migrate_local','1');authStatus.textContent='Готово! Открываем аккаунт…';location.reload();}
  catch(err){authStatus.textContent=err.message||'Не удалось войти.';}
  finally{authSubmit.disabled=false}
});
authLogout.onclick=async()=>{try{await api('auth/logout',{method:'POST',body:{}});for(const key of privateStateKeys){const old=localStorage.getItem(key);if(old!==null)localStorage.setItem('tr_backup_before_cloud_'+key,old);localStorage.removeItem(key)}localStorage.removeItem('tr_last_cloud_user');location.reload()}catch(e){authStatus.textContent=e.message}};

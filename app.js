/* ===== มีไรกินไร — app logic ===== */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  ingredients: [],      // [{name, amount, have:true}]
  menus: [],            // generated menu objects
  activeFilter: 'all',
  currentMenu: null,
  lastRating: 0,
};

/* ---------- screen navigation ---------- */
function showScreen(id){
  $$('.screen').forEach(s => s.classList.remove('active'));
  $('#' + id).classList.add('active');
  window.scrollTo(0,0);
}
function goHome(){
  showScreen('screen-home');
  setNav('home');
  refreshHome();
}
function setNav(name){
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.nav === name));
}
$$('.nav-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const nav = btn.dataset.nav;
    setNav(nav);
    if(nav === 'home'){ showScreen('screen-home'); refreshHome(); }
    if(nav === 'history'){ showScreen('screen-history'); renderHistory(); }
    if(nav === 'saved'){ showScreen('screen-saved'); renderSaved(); }
  });
});

/* ---------- toast ---------- */
let toastTimer;
function toast(msg, isError=false){
  let el = $('#toastEl');
  if(!el){
    el = document.createElement('div');
    el.id = 'toastEl';
    document.body.appendChild(el);
  }
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.remove(), 3200);
}

/* ---------- storage helpers (localStorage) ---------- */
const STORE_KEYS = { saved: 'mrgr_saved_menus', kitchen: 'mrgr_kitchen_history' };
function loadList(key){ try{ return JSON.parse(localStorage.getItem(key)) || []; }catch(e){ return []; } }
function saveList(key, list){ localStorage.setItem(key, JSON.stringify(list.slice(0,30))); }

/* ---------- image capture + compress ---------- */
$('#fileInput').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  if(file.size > 10*1024*1024){ toast('ไฟล์ใหญ่เกิน 10MB ลองรูปอื่นดูนะ', true); return; }
  try{
    const {base64, mediaType} = await compressImage(file);
    await analyzeImage(base64, mediaType);
  }catch(err){
    console.error(err);
    toast('อ่านรูปไม่สำเร็จ ลองใหม่อีกครั้ง', true);
  }
  e.target.value = '';
});

function compressImage(file){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    const reader = new FileReader();
    reader.onload = ()=>{ img.src = reader.result; };
    reader.onerror = reject;
    img.onload = ()=>{
      const maxDim = 1024;
      let {width, height} = img;
      if(width > height && width > maxDim){ height = Math.round(height*(maxDim/width)); width = maxDim; }
      else if(height > maxDim){ width = Math.round(width*(maxDim/height)); height = maxDim; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' });
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------- analyze ingredients ---------- */
async function analyzeImage(base64, mediaType){
  showScreen('screen-analyzing');
  $('#loadingTitle').textContent = 'กำลังดูว่าตู้เย็นคุณมีอะไรบ้าง...';
  $('#loadingSub').textContent = 'แป๊บนึงนะ กำลังแกะรูปอยู่';
  try{
    const res = await fetch('/api/analyze', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ image: base64, mediaType })
    });
    const data = await res.json();
    if(!res.ok || !data.ingredients || !data.ingredients.length){
      showScreen('screen-home');
      toast(data.error || 'วัตถุดิบน้อยไปหน่อย ลองถ่ายเพิ่มอีก 1-2 อย่างไหม?', true);
      return;
    }
    state.ingredients = data.ingredients.map(i => ({ name:i.name, amount:i.amount||'', have:true }));
    // save to kitchen history
    const hist = loadList(STORE_KEYS.kitchen);
    hist.unshift({ ts: Date.now(), ingredients: state.ingredients });
    saveList(STORE_KEYS.kitchen, hist);
    renderIngredients();
    showScreen('screen-ingredients');
  }catch(err){
    console.error(err);
    showScreen('screen-home');
    toast('เชื่อมต่อไม่สำเร็จ ลองอีกครั้งนะ', true);
  }
}

function renderIngredients(){
  const wrap = $('#ingredientChips');
  wrap.innerHTML = state.ingredients.map((ing, idx)=>`
    <div class="magnet">
      <span class="pin"></span>
      <span>${escapeHtml(ing.name)}</span>
      ${ing.amount ? `<span class="amt">· ${escapeHtml(ing.amount)}</span>` : ''}
      <button class="rm" onclick="removeIngredient(${idx})" aria-label="ลบ">✕</button>
    </div>
  `).join('');
}
function removeIngredient(idx){
  state.ingredients.splice(idx,1);
  renderIngredients();
}
$('#btnAddIngredient').addEventListener('click', ()=>{
  const name = prompt('เพิ่มวัตถุดิบ (เช่น ไข่ไก่, หมูสับ)');
  if(name && name.trim()){
    state.ingredients.push({ name:name.trim(), amount:'', have:true });
    renderIngredients();
  }
});

/* ---------- generate menus ---------- */
$('#btnGenerateMenus').addEventListener('click', generateMenus);
async function generateMenus(){
  if(!state.ingredients.length){ toast('เพิ่มวัตถุดิบก่อนนะ', true); return; }
  showScreen('screen-generating');
  try{
    const res = await fetch('/api/menus', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ ingredients: state.ingredients })
    });
    const data = await res.json();
    if(!res.ok || !data.menus || !data.menus.length){
      showScreen('screen-ingredients');
      toast(data.error || 'คิดเมนูไม่สำเร็จ ลองใหม่อีกครั้ง', true);
      return;
    }
    state.menus = data.menus.map((m,i)=>({ ...m, id: m.id || ('m'+i) }));
    applyBadges();
    state.activeFilter = 'all';
    renderFilters();
    renderMenuGrid();
    showScreen('screen-menus');
  }catch(err){
    console.error(err);
    showScreen('screen-ingredients');
    toast('เชื่อมต่อไม่สำเร็จ ลองอีกครั้งนะ', true);
  }
}

function applyBadges(){
  if(!state.menus.length) return;
  const fastest = [...state.menus].sort((a,b)=>(a.timeMinutes||999)-(b.timeMinutes||999))[0];
  const lowestCal = [...state.menus].sort((a,b)=>(a.calories||9999)-(b.calories||9999))[0];
  const bestMatch = [...state.menus].sort((a,b)=>(b.matchPercent||0)-(a.matchPercent||0))[0];
  state.menus.forEach(m=> m.badge = null);
  if(fastest) fastest.badge = 'ทำเร็วสุด';
  if(lowestCal && lowestCal.id !== fastest?.id) lowestCal.badge = 'แคลอรี่ต่ำสุด';
  if(bestMatch && !bestMatch.badge) bestMatch.badge = 'ใช้ของครบสุด';
}

const FILTERS = [
  { key:'all', label:'ทั้งหมด' },
  { key:'fast', label:'ทำเร็ว (<20 นาที)' },
  { key:'lowcal', label:'แคลอรี่ต่ำ' },
  { key:'match', label:'ใช้ของที่มี' },
];
function renderFilters(){
  $('#filterRow').innerHTML = FILTERS.map(f=>`
    <button class="chip-filter ${state.activeFilter===f.key?'active':''}" data-key="${f.key}">${f.label}</button>
  `).join('');
  $$('.chip-filter').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      state.activeFilter = btn.dataset.key;
      renderFilters();
      renderMenuGrid();
    });
  });
}
function filteredMenus(){
  const m = state.menus;
  if(state.activeFilter==='fast') return m.filter(x=>(x.timeMinutes||999)<20);
  if(state.activeFilter==='lowcal') return [...m].sort((a,b)=>(a.calories||9999)-(b.calories||9999)).slice(0, Math.max(2,Math.ceil(m.length/2)));
  if(state.activeFilter==='match') return [...m].sort((a,b)=>(b.matchPercent||0)-(a.matchPercent||0));
  return m;
}
function renderMenuGrid(){
  const list = filteredMenus();
  const grid = $('#menuGrid');
  if(!list.length){
    grid.innerHTML = `<div class="empty-box" style="grid-column:1/-1;"><span class="big">🍽️</span><p>ไม่มีเมนูตรงตัวกรองนี้ ลองตัวกรองอื่นดูนะ</p></div>`;
    return;
  }
  grid.innerHTML = list.map(m=>`
    <button class="menu-card" onclick="openMenuDetail('${m.id}')">
      <div class="art">
        ${m.badge ? `<span class="badge">${m.badge}</span>` : ''}
        ${m.emoji || '🍽️'}
      </div>
      <div class="body">
        <h4>${escapeHtml(m.name)}</h4>
        <div class="meta"><span>⏱️ ${m.timeMinutes||'-'} น.</span><span>🔥 ${m.calories||'-'} kcal</span></div>
        <div class="match">ใช้ของที่มี ${m.matchPercent||0}%</div>
      </div>
    </button>
  `).join('');
}

/* ---------- menu detail ---------- */
function openMenuDetail(id){
  const menu = state.menus.find(m=>m.id===id);
  if(!menu) return;
  state.currentMenu = menu;
  $('#detailName').textContent = menu.name;
  $('#detailEmoji').textContent = menu.emoji || '🍽️';
  $('#detailTags').innerHTML = (menu.tags||[]).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('')
    + `<span class="tag">⏱️ ${menu.timeMinutes||'-'} นาที</span><span class="tag">ระดับ ${menu.difficulty||'ปานกลาง'}</span>`;

  // macro ring
  const macros = menu.macros || {carb:0,protein:0,fat:0};
  const total = Math.max(1, (macros.carb||0)+(macros.protein||0)+(macros.fat||0));
  const C = 2*Math.PI*40;
  const carbFrac = (macros.carb||0)/total, proteinFrac=(macros.protein||0)/total, fatFrac=(macros.fat||0)/total;
  setRing('#ringCarb', carbFrac, 0, C);
  setRing('#ringProtein', proteinFrac, carbFrac*360, C);
  setRing('#ringFat', fatFrac, (carbFrac+proteinFrac)*360, C);
  $('#kcalNum').textContent = menu.calories || '-';
  $('#macroLegend').innerHTML = `
    <div class="row"><span class="dot" style="background:#3fa484"></span>คาร์บ <b class="mono">${macros.carb||0}g</b></div>
    <div class="row"><span class="dot" style="background:#f2a93b"></span>โปรตีน <b class="mono">${macros.protein||0}g</b></div>
    <div class="row"><span class="dot" style="background:#e2604f"></span>ไขมัน <b class="mono">${macros.fat||0}g</b></div>
  `;

  // ingredients table
  const rows = (menu.ingredientsUsed||[]).map(ing=>`
    <tr>
      <td><span class="ing-check ${ing.have?'have':'need'}">${ing.have?'✓':'!'}</span></td>
      <td>${escapeHtml(ing.name)}</td>
      <td>${escapeHtml(ing.amount||'')}</td>
    </tr>
  `).join('');
  $('#detailIngredients').innerHTML = rows || `<tr><td colspan="3" style="color:var(--text-soft);">ไม่มีข้อมูลวัตถุดิบ</td></tr>`;

  // steps
  $('#detailSteps').innerHTML = (menu.steps||[]).map((s,i)=>`
    <div class="step-item">
      <div class="step-num">${i+1}</div>
      <div style="flex:1;">
        <h5>${escapeHtml(s.title||('ขั้นตอนที่ '+(i+1)))}</h5>
        <p>${escapeHtml(s.detail||'')}</p>
        ${s.timerSeconds ? `<div class="timer-chip" data-seconds="${s.timerSeconds}" data-remaining="${s.timerSeconds}">⏲ <span class="tlabel">${formatTime(s.timerSeconds)}</span><button class="tbtn" onclick="toggleTimer(this)">เริ่ม</button></div>` : ''}
      </div>
    </div>
  `).join('') || `<div class="empty-box"><p>ไม่มีขั้นตอนทำอาหาร</p></div>`;

  showScreen('screen-detail');
}
function setRing(sel, frac, rotateDeg, C){
  const el = $(sel);
  const len = Math.max(0, frac*C - 2); // small gap between segments
  el.setAttribute('stroke-dasharray', `${len} ${C}`);
  el.setAttribute('transform', `rotate(${rotateDeg} 46 46)`);
  el.style.opacity = frac > 0.001 ? '1' : '0';
}
function formatTime(sec){
  const m = Math.floor(sec/60), s = sec%60;
  return `${m}:${String(s).padStart(2,'0')}`;
}
function toggleTimer(btn){
  const chip = btn.closest('.timer-chip');
  if(chip.dataset.running === '1'){
    clearInterval(Number(chip.dataset.intervalId));
    chip.dataset.running = '0';
    btn.textContent = 'เริ่ม';
    return;
  }
  chip.dataset.running = '1';
  btn.textContent = 'หยุด';
  const id = setInterval(()=>{
    let rem = Number(chip.dataset.remaining) - 1;
    if(rem <= 0){
      clearInterval(id);
      chip.dataset.running = '0';
      chip.classList.add('done');
      chip.querySelector('.tlabel').textContent = 'เสร็จแล้ว!';
      btn.style.display='none';
      return;
    }
    chip.dataset.remaining = rem;
    chip.querySelector('.tlabel').textContent = formatTime(rem);
  }, 1000);
  chip.dataset.intervalId = id;
}

$('#btnDetailBack').addEventListener('click', ()=> showScreen('screen-menus'));

$('#btnSaveMenu').addEventListener('click', ()=>{
  if(!state.currentMenu) return;
  const list = loadList(STORE_KEYS.saved);
  if(list.some(m=>m.name===state.currentMenu.name)){
    toast('บันทึกเมนูนี้ไว้แล้ว');
    return;
  }
  list.unshift({ ...state.currentMenu, savedAt: Date.now() });
  saveList(STORE_KEYS.saved, list);
  toast('บันทึกเมนูแล้ว 💾');
});

$('#btnFinishCooking').addEventListener('click', ()=>{
  state.lastRating = 0;
  $$('#ratingStars button').forEach(b=>b.classList.remove('active'));
  showScreen('screen-rating');
});
$('#ratingStars').addEventListener('click', (e)=>{
  const btn = e.target.closest('button');
  if(!btn) return;
  const v = Number(btn.dataset.v);
  state.lastRating = v;
  $$('#ratingStars button').forEach(b=> b.classList.toggle('active', Number(b.dataset.v) <= v));
});

/* ---------- saved / history screens ---------- */
function renderSaved(){
  const list = loadList(STORE_KEYS.saved);
  const wrap = $('#savedList');
  wrap.innerHTML = list.length ? list.map(m=>`
    <button class="list-card" onclick='openSavedMenu(${JSON.stringify(m.id||m.name).replace(/'/g,"&#39;")})'>
      <div class="ic">${m.emoji||'🍽️'}</div>
      <div class="txt"><h3>${escapeHtml(m.name)}</h3><div class="meta">⏱️${m.timeMinutes||'-'} น. · 🔥${m.calories||'-'} kcal</div></div>
    </button>
  `).join('') : `<div class="empty-box"><span class="big">💾</span><p>ยังไม่มีเมนูที่บันทึกไว้เลย ลองคิดเมนูแล้วกดบันทึกดูนะ</p></div>`;
}
function openSavedMenu(idOrName){
  const list = loadList(STORE_KEYS.saved);
  const menu = list.find(m => m.id===idOrName || m.name===idOrName);
  if(!menu) return;
  state.menus = [menu];
  openMenuDetail(menu.id || menu.name);
}
window.openSavedMenu = openSavedMenu;

function renderHistory(){
  const hist = loadList(STORE_KEYS.kitchen);
  const wrap = $('#historyList');
  wrap.innerHTML = hist.length ? hist.map(h=>`
    <div class="list-card" style="align-items:flex-start;">
      <div class="ic">🧊</div>
      <div class="txt">
        <h3>${new Date(h.ts).toLocaleDateString('th-TH', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</h3>
        <div class="meta">${h.ingredients.map(i=>escapeHtml(i.name)).join(', ')}</div>
      </div>
    </div>
  `).join('') : `<div class="empty-box"><span class="big">🧊</span><p>ยังไม่มีประวัติการถ่ายรูปตู้เย็นเลย</p></div>`;
}

function refreshHome(){
  const hist = loadList(STORE_KEYS.kitchen).slice(0,6);
  $('#homeKitchenPreview').innerHTML = hist.length ? hist.map(h=>`
    <div class="kitchen-chip">
      <div class="ic">🧊</div>
      <div class="lbl">${h.ingredients.slice(0,2).map(i=>escapeHtml(i.name)).join(', ')}</div>
    </div>
  `).join('') : `<div class="empty-box" style="padding:16px;"><span class="big">📷</span><p>เริ่มจากการถ่ายรูปของในตู้เย็น แล้วเราจะช่วยคิดเมนูให้คุณ</p></div>`;

  const saved = loadList(STORE_KEYS.saved).slice(0,3);
  $('#homeSavedPreview').innerHTML = saved.length ? saved.map(m=>`
    <button class="list-card" onclick='openSavedMenu(${JSON.stringify(m.id||m.name).replace(/'/g,"&#39;")})'>
      <div class="ic">${m.emoji||'🍽️'}</div>
      <div class="txt"><h3>${escapeHtml(m.name)}</h3><div class="meta">⏱️${m.timeMinutes||'-'} น. · 🔥${m.calories||'-'} kcal</div></div>
    </button>
  `).join('') : `<div class="empty-box" style="padding:16px;"><span class="big">💾</span><p>ยังไม่มีเมนูที่บันทึกไว้เลย</p></div>`;
}

/* ---------- help ---------- */
$('#btnHelp').addEventListener('click', ()=>{
  alert('วิธีใช้:\n1) ถ่ายรูปตู้เย็นหรือวัตถุดิบที่มี\n2) ตรวจสอบ/แก้ไขรายการวัตถุดิบ\n3) กด "คิดเมนูให้หน่อย"\n4) เลือกเมนูที่ชอบ ดูวิธีทำทีละขั้นตอน\n5) บันทึกเมนูโปรดไว้ดูภายหลังได้');
});

function escapeHtml(str=''){
  return String(str).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

window.goHome = goHome;
window.removeIngredient = removeIngredient;
window.openMenuDetail = openMenuDetail;
window.toggleTimer = toggleTimer;

/* ---------- init ---------- */
refreshHome();

const STORAGE_KEY = 'schedule_app_v0_1_database';
const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const DAY_LABEL = {monday:'Monday',tuesday:'Tuesday',wednesday:'Wednesday',thursday:'Thursday',friday:'Friday',saturday:'Saturday',sunday:'Sunday'};
const ROLE_LABEL = {server:'Server',dish_runner:'Dishwasher / Runner'};

let state = null;
let currentSchedule = null;
let deferredInstallPrompt = null;

const $ = (id) => document.getElementById(id);
const qsa = (sel, root=document) => [...root.querySelectorAll(sel)];

function deepClone(obj){ return JSON.parse(JSON.stringify(obj)); }
function uid(prefix='id'){ return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`; }
function pad(n){ return String(n).padStart(2,'0'); }
function toISODate(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function fromISODate(s){ const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d,12,0,0,0); }
function addDays(s, n){ const d=fromISODate(s); d.setDate(d.getDate()+n); return toISODate(d); }
function mondayOf(s){ const d=fromISODate(s); const day=(d.getDay()+6)%7; d.setDate(d.getDate()-day); return toISODate(d); }
function minutes(t){ const [h,m]=t.split(':').map(Number); return h*60+m; }
function timeFromMinutes(n){ n=Math.max(0,Math.min(1439,n)); return `${pad(Math.floor(n/60))}:${pad(n%60)}`; }
function fmtTime(t){ if(!t) return ''; const [h,m]=t.split(':').map(Number); const suffix=h>=12?'PM':'AM'; const hh=h%12||12; return `${hh}:${pad(m)} ${suffix}`; }
function fmtDate(s, opts={weekday:'short',month:'short',day:'numeric'}){ return fromISODate(s).toLocaleDateString(undefined,opts); }
function overlap(aStart,aEnd,bStart,bEnd){ return minutes(aStart)<minutes(bEnd) && minutes(bStart)<minutes(aEnd); }
function contains(aStart,aEnd,bStart,bEnd){ return minutes(aStart)<=minutes(bStart) && minutes(aEnd)>=minutes(bEnd); }
function roleLabel(r){ return ROLE_LABEL[r] || r; }

async function loadBundledData(){
  const res = await fetch('./schedule-data.json', {cache:'no-store'});
  if(!res.ok) throw new Error(`Could not load schedule-data.json (${res.status})`);
  return await res.json();
}

async function init(){
  bindTabs();
  bindActions();
  buildAvailabilityMatrix();
  try{
    const saved = localStorage.getItem(STORAGE_KEY);
    state = saved ? JSON.parse(saved) : await loadBundledData();
    normalizeState();
    saveState();
    const today = toISODate(new Date());
    $('weekDate').value = mondayOf(today);
    $('includeSupport').checked = !!state.settings.includeOptionalSupportByDefault;
    renderAll();
    loadExistingOrGenerate();
  }catch(err){
    console.error(err);
    showToast('Could not load database. Import schedule-data.json from the Data tab.', 5000);
    state = emptyState();
    renderAll();
  }
  registerServiceWorker();
}

function emptyState(){
  return {
    meta:{schemaVersion:1,appVersion:'0.1.0',restaurantName:'El Mexican Restaurant',updatedAt:new Date().toISOString()},
    settings:{includeOptionalSupportByDefault:true}, businessHours:{}, coverageTemplates:{}, priorityRules:[], employees:[], weeklyExceptions:[], specialDateOverrides:[], scheduleHistory:[]
  };
}

function normalizeState(){
  state.settings ||= {};
  state.businessHours ||= {};
  state.coverageTemplates ||= {};
  state.priorityRules ||= [];
  state.employees ||= [];
  state.weeklyExceptions ||= [];
  state.specialDateOverrides ||= [];
  state.scheduleHistory ||= [];
  state.meta ||= {schemaVersion:1,appVersion:'0.1.0'};
}

function saveState(){
  state.meta.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderDataInfo();
}

function bindTabs(){
  qsa('.tab').forEach(btn => btn.addEventListener('click', () => {
    qsa('.tab').forEach(x=>x.classList.toggle('active',x===btn));
    qsa('.tab-panel').forEach(p=>p.classList.remove('active'));
    $(`tab-${btn.dataset.tab}`).classList.add('active');
  }));
}

function bindActions(){
  $('generateBtn').addEventListener('click', generateAndRender);
  $('weekDate').addEventListener('change', loadExistingOrGenerate);
  $('includeSupport').addEventListener('change', () => {
    state.settings.includeOptionalSupportByDefault = $('includeSupport').checked;
    saveState();
  });
  $('printBtn').addEventListener('click', () => window.print());
  $('shareBtn').addEventListener('click', shareSchedule);
  $('addEmployeeBtn').addEventListener('click', () => openEmployeeDialog());
  $('closeEmployeeDialog').addEventListener('click', () => $('employeeDialog').close());
  $('employeeForm').addEventListener('submit', saveEmployeeFromDialog);
  $('archiveEmployeeBtn').addEventListener('click', archiveEmployeeFromDialog);
  $('exceptionForm').addEventListener('submit', addException);
  $('exceptionStartDate')?.addEventListener('change',()=>{
    if(!$('exceptionEndDate').value || $('exceptionEndDate').value<$('exceptionStartDate').value){
      $('exceptionEndDate').value=$('exceptionStartDate').value;
    }
  });
  $('closeAvailabilityDialog')?.addEventListener('click', () => $('availabilityDialog').close());
  $('availabilityForm')?.addEventListener('submit', saveAvailabilityFromDialog);
  $('overrideForm').addEventListener('submit', addOverride);
  $('exportBtn').addEventListener('click', exportJson);
  $('importFile').addEventListener('change', importJson);
  $('resetBtn').addEventListener('click', resetBundled);
  $('installBtn').addEventListener('click', async () => {
    if(!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt=null;
    $('installBtn').classList.add('hidden');
  });
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferredInstallPrompt=e; $('installBtn').classList.remove('hidden');
  });
}

function renderAll(){
  renderEmployees();
  renderNormalAvailability();
  renderExceptionEmployeeOptions();
  renderExceptions();
  renderCoverageRules();
  renderPriorityRules();
  renderOverrides();
  renderDataInfo();
}

function coverageSlotsForWeek(weekStart, includeOptional){
  const slots=[];
  DAYS.forEach((day, idx)=>{
    const date=addDays(weekStart, idx);
    const hours=state.businessHours[day] || {open:'00:00',close:'23:59'};
    const base=(state.coverageTemplates[day]||[])
      .filter(t=>t.required || includeOptional)
      .map(t=>({
        ...deepClone(t),
        id:`${date}:${t.id}`,
        templateId:t.id,
        date, day,
        start:t.start==='OPEN'?hours.open:t.start,
        end:t.end==='CLOSE'?hours.close:t.end,
        source:'template'
      }));
    const extras=(state.specialDateOverrides||[])
      .filter(o=>o.date===date)
      .map(o=>({
        id:`${date}:override:${o.id}`,
        templateId:`override:${o.id}`,
        date, day, role:o.role, label:o.label || 'Extra coverage', start:o.start, end:o.end, required:o.required!==false, source:'override'
      }));
    slots.push(...base,...extras);
  });
  return slots.sort((a,b)=>a.date.localeCompare(b.date)||minutes(a.start)-minutes(b.start)||a.role.localeCompare(b.role));
}

function generateSchedule(weekStart){
  const includeOptional=$('includeSupport').checked;
  const slots=coverageSlotsForWeek(weekStart, includeOptional);
  const assignments=[];

  // Apply recurring fixed assignments first. They may intentionally cover overlapping coverage blocks.
  for(const slot of slots){
    const fixedCandidates=state.employees.filter(emp => {
      if(!emp.active || !emp.roles?.includes(slot.role)) return false;
      return (emp.recurringAssignments||[]).some(a=>{
        if(a.day!==slot.day || a.role!==slot.role) return false;
        const h=state.businessHours[slot.day]||{};
        const s=a.start==='OPEN'?h.open:a.start;
        const e=a.end==='CLOSE'?h.close:a.end;
        return s && e && contains(s,e,slot.start,slot.end);
      });
    });
    if(fixedCandidates.length){
      const emp=fixedCandidates[0];
      assignments.push({slotId:slot.id,employeeId:emp.id,source:'fixed'});
    }
  }

  const unassigned = slots.filter(s=>!assignments.some(a=>a.slotId===s.id));
  // Fill scarce coverage first so a flexible employee is not consumed by a slot
  // that another employee could have covered. Then use business importance.
  unassigned.sort((a,b)=>{
    const scarcityA=state.employees.filter(emp=>basicEligibleForSlot(emp,a)).length;
    const scarcityB=state.employees.filter(emp=>basicEligibleForSlot(emp,b)).length;
    return scarcityA-scarcityB || slotImportance(b)-slotImportance(a) || a.date.localeCompare(b.date) || minutes(a.start)-minutes(b.start);
  });

  for(const slot of unassigned){
    const candidates=state.employees
      .filter(emp=>eligibleForSlot(emp,slot,assignments))
      .map(emp=>({emp,score:candidateScore(emp,slot,assignments)}))
      .sort((a,b)=>a.score-b.score || a.emp.name.localeCompare(b.emp.name));
    if(candidates.length){
      assignments.push({slotId:slot.id,employeeId:candidates[0].emp.id,source:'auto'});
    }
  }

  rebalanceGuaranteedHours(assignments, slots);

  const schedule={
    id:uid('sched'), weekStart, includeOptionalSupport:includeOptional,
    generatedAt:new Date().toISOString(), slots, assignments
  };
  currentSchedule=schedule;
  saveScheduleToHistory(schedule);
  return schedule;
}


function priorityTierFor(rule, empId){
  if(!rule) return null;
  for(let i=0;i<rule.tiers.length;i++) if(rule.tiers[i].includes(empId)) return i;
  return null;
}

function canDisplaceByPriority(empId, currentEmpId, slot){
  const rule=applicablePriorityRule(slot);
  if(!rule) return true;
  const challenger=priorityTierFor(rule,empId);
  const current=priorityTierFor(rule,currentEmpId);
  if(current===null) return challenger!==null; // named priority employee may replace an unlisted one
  if(challenger===null) return false;
  return challenger<=current;
}

function conflictingAssignments(empId, slot, assignments, slots, excludedSlotIds=[]){
  return assignments.filter(a=>{
    if(a.employeeId!==empId || excludedSlotIds.includes(a.slotId)) return false;
    const s=findSlot(a.slotId,slots);
    return s && s.date===slot.date && overlap(s.start,s.end,slot.start,slot.end);
  });
}

function rebalanceGuaranteedHours(assignments, slots){
  const guaranteed=state.employees.filter(e=>e.active && e.minWeeklyHours!=null).sort((a,b)=>Number(b.minWeeklyHours)-Number(a.minWeeklyHours));
  for(const emp of guaranteed){
    let guard=0;
    while(hoursForEmployee(emp.id,{slots,assignments})+0.001<Number(emp.minWeeklyHours) && guard++<20){
      const before=hoursForEmployee(emp.id,{slots,assignments});
      const options=[];
      for(const target of assignments){
        if(target.employeeId===emp.id || target.source==='fixed') continue;
        const targetSlot=findSlot(target.slotId,slots);
        if(!targetSlot || !emp.roles?.includes(targetSlot.role) || !isAvailable(emp,targetSlot)) continue;
        if(!canDisplaceByPriority(emp.id,target.employeeId,targetSlot)) continue;
        const displaced=employeeById(target.employeeId);
        const conflicts=conflictingAssignments(emp.id,targetSlot,assignments,slots,[target.slotId]);
        if(conflicts.length>1) continue;

        if(conflicts.length===0){
          const temp=assignments.map(a=>a===target?{...a,employeeId:emp.id,source:'auto_guarantee'}:{...a});
          const after=hoursForEmployee(emp.id,{slots,assignments:temp});
          if(after<=before+0.001) continue;
          if(emp.maxWeeklyHours!=null && after>Number(emp.maxWeeklyHours)+0.001) continue;
          if(displaced?.minWeeklyHours!=null && hoursForEmployee(displaced.id,{slots,assignments:temp})+0.001<Number(displaced.minWeeklyHours)) continue;
          options.push({gain:after-before,importance:slotImportance(targetSlot),temp});
          continue;
        }

        // One-for-one swap: useful when the guaranteed employee is already on the shorter
        // overlapping shift and can trade into the longer shift without losing coverage.
        const conflict=conflicts[0];
        if(conflict.source==='fixed' || !displaced) continue;
        const conflictSlot=findSlot(conflict.slotId,slots);
        if(!conflictSlot || !displaced.roles?.includes(conflictSlot.role) || !isAvailable(displaced,conflictSlot)) continue;
        if(!canDisplaceByPriority(displaced.id,emp.id,conflictSlot)) continue;
        const base=assignments.filter(a=>a!==target && a!==conflict).map(a=>({...a}));
        if(conflictingAssignments(displaced.id,conflictSlot,base,slots).length) continue;
        const temp=[...base,{...target,employeeId:emp.id,source:'auto_guarantee'},{...conflict,employeeId:displaced.id,source:'auto_swap'}];
        const after=hoursForEmployee(emp.id,{slots,assignments:temp});
        if(after<=before+0.001) continue;
        if(emp.maxWeeklyHours!=null && after>Number(emp.maxWeeklyHours)+0.001) continue;
        if(displaced.maxWeeklyHours!=null && hoursForEmployee(displaced.id,{slots,assignments:temp})>Number(displaced.maxWeeklyHours)+0.001) continue;
        if(displaced.minWeeklyHours!=null && hoursForEmployee(displaced.id,{slots,assignments:temp})+0.001<Number(displaced.minWeeklyHours)) continue;
        options.push({gain:after-before,importance:slotImportance(targetSlot),temp});
      }
      if(!options.length) break;
      options.sort((a,b)=>b.gain-a.gain || b.importance-a.importance);
      assignments.splice(0,assignments.length,...options[0].temp);
    }
  }
}

function slotImportance(slot){
  let v=0;
  if(applicablePriorityRule(slot)) v+=100;
  if(['friday','saturday','sunday'].includes(slot.day)) v+=50;
  if(slot.start>='15:00') v+=10;
  if(slot.required) v+=5;
  return v;
}

function applicablePriorityRule(slot){
  return (state.priorityRules||[]).find(r => r.role===slot.role && r.days?.includes(slot.day) && (!r.startBefore || minutes(slot.start)<minutes(r.startBefore)));
}


function basicEligibleForSlot(emp,slot){
  if(!emp.active || !emp.roles?.includes(slot.role)) return false;
  if(!isAvailable(emp,slot)) return false;
  return true;
}

function candidateScore(emp,slot,assignments){
  let score=100;
  const rule=applicablePriorityRule(slot);
  if(rule){
    let tierIndex=-1;
    rule.tiers.forEach((tier,i)=>{ if(tier.includes(emp.id)) tierIndex=i; });
    if(tierIndex>=0) score += tierIndex*40 - 70;
    else score += 50;
  }
  const hours=hoursForEmployee(emp.id, currentLike(slot,assignments));
  score += hours*1.4;
  if(emp.minWeeklyHours!=null && hours < Number(emp.minWeeklyHours)){
    const busy = ['friday','saturday','sunday'].includes(slot.day) ? 24 : 12;
    score -= busy;
  }
  if(emp.flexibility==='backup') score+=35;
  if(emp.flexibility==='variable') score+=8;
  return score;
}

function currentLike(slot, assignments){
  const slots = currentSchedule?.slots?.length ? currentSchedule.slots : coverageSlotsForWeek(mondayOf(slot.date), $('includeSupport').checked);
  return {slots,assignments};
}

function eligibleForSlot(emp,slot,assignments){
  if(!emp.active || !emp.roles?.includes(slot.role)) return false;
  if(!isAvailable(emp,slot)) return false;
  if(hasConflict(emp.id,slot,assignments)) return false;
  if(exceedsMaxHours(emp,slot,assignments)) return false;
  if(emp.constraints?.maxWeekendMorningShifts && ['saturday','sunday'].includes(slot.day) && minutes(slot.start)<12*60){
    const count=assignments.filter(a=>{
      if(a.employeeId!==emp.id) return false;
      const s=findSlot(a.slotId, currentSchedule?.slots || coverageSlotsForWeek(mondayOf(slot.date), $('includeSupport').checked));
      return s && ['saturday','sunday'].includes(s.day) && minutes(s.start)<12*60;
    }).length;
    if(count>=emp.constraints.maxWeekendMorningShifts) return false;
  }
  return true;
}

function isAvailable(emp,slot){
  const dayExceptions=(state.weeklyExceptions||[]).filter(e=>e.employeeId===emp.id && e.date===slot.date && overlap(e.start,e.end,slot.start,slot.end));
  if(dayExceptions.some(e=>e.type==='unavailable')) return false;
  if(dayExceptions.some(e=>e.type==='available' && contains(e.start,e.end,slot.start,slot.end))) return true;
  if(emp.availabilityMode==='weekly_variable') return false;
  const tokens=emp.recurringAvailability?.[slot.day] || [];
  if(tokens.includes('ALL')) return true;
  const period=minutes(slot.start)<14*60 ? 'AM':'PM';
  return tokens.includes(period);
}

function hasConflict(empId,slot,assignments){
  return assignments.some(a=>{
    if(a.employeeId!==empId) return false;
    const s=findSlot(a.slotId, currentSchedule?.slots || coverageSlotsForWeek(mondayOf(slot.date), $('includeSupport').checked));
    if(!s || s.date!==slot.date) return false;
    if(a.source==='fixed') return false; // recurring all-day assignments intentionally cover multiple blocks
    return overlap(s.start,s.end,slot.start,slot.end);
  });
}

function exceedsMaxHours(emp,slot,assignments){
  if(emp.maxWeeklyHours==null || emp.maxWeeklyHours==='') return false;
  const temp={slots:currentSchedule?.slots || coverageSlotsForWeek(mondayOf(slot.date), $('includeSupport').checked), assignments:[...assignments,{slotId:slot.id,employeeId:emp.id}]};
  return hoursForEmployee(emp.id,temp) > Number(emp.maxWeeklyHours)+0.01;
}

function findSlot(slotId, slots=currentSchedule?.slots||[]){ return slots.find(s=>s.id===slotId); }
function employeeById(id){ return state.employees.find(e=>e.id===id); }

function hoursForEmployee(empId,schedule=currentSchedule){
  if(!schedule) return 0;
  const byDate={};
  for(const a of schedule.assignments||[]){
    if(a.employeeId!==empId) continue;
    const s=findSlot(a.slotId,schedule.slots);
    if(!s) continue;
    (byDate[s.date] ||= []).push([minutes(s.start),minutes(s.end)]);
  }
  let total=0;
  Object.values(byDate).forEach(intervals=>{
    intervals.sort((a,b)=>a[0]-b[0]);
    const merged=[];
    intervals.forEach(int=>{
      const last=merged[merged.length-1];
      if(!last || int[0]>last[1]) merged.push([...int]);
      else last[1]=Math.max(last[1],int[1]);
    });
    total += merged.reduce((sum,[s,e])=>sum+(e-s)/60,0);
  });
  return Math.round(total*100)/100;
}

function saveScheduleToHistory(schedule){
  state.scheduleHistory ||= [];
  const idx=state.scheduleHistory.findIndex(s=>s.weekStart===schedule.weekStart);
  if(idx>=0) state.scheduleHistory[idx]=deepClone(schedule); else state.scheduleHistory.unshift(deepClone(schedule));
  state.scheduleHistory=state.scheduleHistory.slice(0,26);
  saveState();
}

function loadExistingOrGenerate(){
  if(!state) return;
  const week=mondayOf($('weekDate').value || toISODate(new Date()));
  $('weekDate').value=week;
  const existing=(state.scheduleHistory||[]).find(s=>s.weekStart===week && s.includeOptionalSupport===$('includeSupport').checked);
  if(existing){ currentSchedule=deepClone(existing); renderSchedule(); }
  else generateAndRender();
}
function generateAndRender(){
  const week=mondayOf($('weekDate').value || toISODate(new Date()));
  $('weekDate').value=week;
  currentSchedule=null; // avoid previous week influencing scoring/conflict lookup
  generateSchedule(week);
  renderSchedule();
  showToast('Schedule generated');
}

function renderSchedule(){
  if(!currentSchedule) return;
  const grid=$('scheduleGrid'); grid.innerHTML='';
  DAYS.forEach((day,idx)=>{
    const date=addDays(currentSchedule.weekStart,idx);
    const card=document.createElement('article'); card.className='day-card';
    const daySlots=currentSchedule.slots.filter(s=>s.date===date).sort((a,b)=>minutes(a.start)-minutes(b.start));
    card.innerHTML=`<div class="day-head"><h3>${DAY_LABEL[day]}</h3><div class="date">${fmtDate(date,{month:'short',day:'numeric'})}</div></div>`;
    if(!daySlots.length){ card.innerHTML += `<div class="slot"><span class="list-row-sub">No coverage rules.</span></div>`; }
    daySlots.forEach(slot=>card.appendChild(renderSlot(slot)));
    grid.appendChild(card);
  });
  renderStatsAndAlerts();
  renderHours();
}

function renderSlot(slot){
  const wrap=document.createElement('div'); wrap.className='slot';
  const assignment=currentSchedule.assignments.find(a=>a.slotId===slot.id);
  const assignedEmp=assignment?employeeById(assignment.employeeId):null;
  wrap.innerHTML=`
    <div class="slot-top">
      <div><div class="slot-label">${escapeHtml(slot.label)}${slot.required?'':'<span class="optional">OPTIONAL</span>'}</div><span class="role-badge ${slot.role==='dish_runner'?'support':''}">${roleLabel(slot.role)}</span></div>
      <div class="slot-time">${fmtTime(slot.start)}–${fmtTime(slot.end)}</div>
    </div>
    <div class="assignment"></div>`;
  const aWrap=wrap.querySelector('.assignment');
  const select=document.createElement('select');
  const blank=document.createElement('option'); blank.value=''; blank.textContent=slot.required?'— Uncovered —':'— No support assigned —'; select.appendChild(blank);
  state.employees.filter(e=>e.active && e.roles?.includes(slot.role)).forEach(emp=>{
    const opt=document.createElement('option'); opt.value=emp.id;
    const ok=isAvailable(emp,slot);
    opt.textContent=`${emp.name}${ok?'':' · not normally available'}`;
    if(assignedEmp?.id===emp.id) opt.selected=true;
    select.appendChild(opt);
  });
  select.addEventListener('change',()=>manualAssign(slot,select.value));
  aWrap.appendChild(select);
  if(assignment?.source==='fixed'){
    const mark=document.createElement('span'); mark.className='fixed-mark'; mark.textContent='Recurring'; aWrap.appendChild(mark);
  } else if(!assignment && slot.required){
    const mark=document.createElement('span'); mark.className='gap-mark'; mark.textContent='Gap'; aWrap.appendChild(mark);
  }
  return wrap;
}

function manualAssign(slot,employeeId){
  currentSchedule.assignments=currentSchedule.assignments.filter(a=>a.slotId!==slot.id);
  if(employeeId) currentSchedule.assignments.push({slotId:slot.id,employeeId,source:'manual'});
  saveScheduleToHistory(currentSchedule);
  renderSchedule();
  const emp=employeeById(employeeId);
  if(emp && !isAvailable(emp,slot)) showToast(`${emp.name} is not normally available for that shift`, 3500);
}

function renderStatsAndAlerts(){
  const requiredGaps=currentSchedule.slots.filter(s=>s.required && !currentSchedule.assignments.some(a=>a.slotId===s.id));
  const optionalGaps=currentSchedule.slots.filter(s=>!s.required && !currentSchedule.assignments.some(a=>a.slotId===s.id));
  const totalHours=state.employees.reduce((sum,e)=>sum+hoursForEmployee(e.id,currentSchedule),0);
  const beto=state.employees.find(e=>e.id==='emp_beto');
  const betoHours=beto?hoursForEmployee(beto.id,currentSchedule):0;
  $('scheduleStats').innerHTML=`
    <div class="stat"><div class="value">${requiredGaps.length}</div><div class="label">Required gaps</div></div>
    <div class="stat"><div class="value">${optionalGaps.length}</div><div class="label">Support gaps</div></div>
    <div class="stat"><div class="value">${totalHours.toFixed(1)}</div><div class="label">Scheduled hours</div></div>
    <div class="stat"><div class="value">${betoHours.toFixed(1)}</div><div class="label">Beto hours</div></div>`;
  const alerts=[];
  if(requiredGaps.length) alerts.push(`<div class="alert warn">${requiredGaps.length} required shift${requiredGaps.length===1?' is':'s are'} still uncovered.</div>`);
  if(beto?.minWeeklyHours!=null && betoHours<Number(beto.minWeeklyHours)) alerts.push(`<div class="alert warn">Beto is at ${betoHours.toFixed(1)} hours; his minimum is ${Number(beto.minWeeklyHours).toFixed(0)}.</div>`);
  const issues=manualIssues();
  issues.forEach(x=>alerts.push(`<div class="alert warn">${escapeHtml(x)}</div>`));
  if(!alerts.length) alerts.push(`<div class="alert ok">No required coverage gaps or guaranteed-hour warnings detected.</div>`);
  $('alerts').innerHTML=alerts.join('');
}

function manualIssues(){
  const issues=[];
  for(const a of currentSchedule.assignments.filter(a=>a.source==='manual')){
    const emp=employeeById(a.employeeId), slot=findSlot(a.slotId,currentSchedule.slots);
    if(emp&&slot&&!isAvailable(emp,slot)) issues.push(`${emp.name} was manually assigned outside normal/weekly availability on ${DAY_LABEL[slot.day]} ${fmtTime(slot.start)}.`);
  }
  return issues;
}

function renderHours(){
  const rows=state.employees.filter(e=>e.active).map(emp=>{
    const h=hoursForEmployee(emp.id,currentSchedule);
    const min=emp.minWeeklyHours;
    const cls=min!=null ? (h+0.001<Number(min)?'hours-low':'hours-ok') : '';
    return `<tr><td>${escapeHtml(emp.name)}</td><td>${roleLabel(emp.roles?.[0])}</td><td class="${cls}">${h.toFixed(1)}</td><td>${min!=null?Number(min).toFixed(0):'—'}</td></tr>`;
  }).join('');
  $('hoursTableWrap').innerHTML=`<table><thead><tr><th>Employee</th><th>Role</th><th>Hours</th><th>Minimum</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderEmployees(){
  const root=$('employeeList'); root.innerHTML='';
  state.employees.forEach(emp=>{
    const card=document.createElement('div'); card.className=`employee-card${emp.active?'':' archived'}`;
    const availability=availabilitySummary(emp);
    card.innerHTML=`
      <div class="employee-top"><div><div class="employee-name">${escapeHtml(emp.name)}</div><div class="list-row-sub">${roleLabel(emp.roles?.[0])}</div></div><span class="chip">${emp.active?'Active':'Archived'}</span></div>
      <div class="employee-meta">
        <span class="chip">${escapeHtml(emp.availabilityMode==='weekly_variable'?'Weekly variable':'Recurring availability')}</span>
        <span class="chip">Flex: ${escapeHtml(emp.flexibility||'normal')}</span>
        ${emp.minWeeklyHours!=null?`<span class="chip">Min ${emp.minWeeklyHours} hrs</span>`:''}
      </div>
      <div class="employee-notes"><strong>Availability:</strong> ${escapeHtml(availability)}</div>
      ${emp.notes?`<div class="employee-notes">${escapeHtml(emp.notes)}</div>`:''}
      <div class="employee-actions"><button type="button" data-edit="${emp.id}">Edit</button></div>`;
    card.querySelector('[data-edit]').addEventListener('click',()=>openEmployeeDialog(emp.id));
    root.appendChild(card);
  });
}

function availabilitySummary(emp){
  if(emp.availabilityMode==='weekly_variable') return 'Entered fresh each week';
  const pieces=[];
  DAYS.forEach(day=>{
    const t=emp.recurringAvailability?.[day]||[];
    if(!t.length) return;
    let s=t.includes('ALL') || (t.includes('AM')&&t.includes('PM')) ? 'all day' : t.join('/');
    pieces.push(`${DAY_LABEL[day].slice(0,3)} ${s}`);
  });
  return pieces.join(', ') || 'No normal availability entered';
}

function buildAvailabilityMatrix(){
  const root=$('availabilityMatrix');
  root.innerHTML='<div></div><strong>AM</strong><strong>PM</strong>';
  DAYS.forEach(day=>{
    root.insertAdjacentHTML('beforeend',`<div class="dayname">${DAY_LABEL[day]}</div><label><input type="checkbox" data-av-day="${day}" data-av-period="AM"> AM</label><label><input type="checkbox" data-av-day="${day}" data-av-period="PM"> PM</label>`);
  });
}

function openEmployeeDialog(empId=null){
  const emp=empId?employeeById(empId):null;
  $('employeeDialogTitle').textContent=emp?'Edit Employee':'Add Employee';
  $('employeeId').value=emp?.id||'';
  $('employeeName').value=emp?.name||'';
  $('employeeActive').checked=emp?.active??true;
  $('employeeRole').value=emp?.roles?.[0]||'server';
  $('employeeAvailabilityMode').value=emp?.availabilityMode||'recurring';
  $('employeeFlexibility').value=emp?.flexibility||'normal';
  $('employeeMinHours').value=emp?.minWeeklyHours??'';
  $('employeeMaxHours').value=emp?.maxWeeklyHours??'';
  $('employeeNotes').value=emp?.notes||'';
  qsa('[data-av-day]').forEach(cb=>{
    const tokens=emp?.recurringAvailability?.[cb.dataset.avDay]||[];
    cb.checked=tokens.includes('ALL')||tokens.includes(cb.dataset.avPeriod);
  });
  $('archiveEmployeeBtn').textContent=emp?.active===false?'Reactivate':'Archive';
  $('archiveEmployeeBtn').classList.toggle('hidden',!emp);
  $('employeeDialog').showModal();
}

function saveEmployeeFromDialog(e){
  e.preventDefault();
  const id=$('employeeId').value || uid('emp');
  const existing=employeeById(id);
  const recurringAvailability={};
  DAYS.forEach(day=>{
    const selected=qsa(`[data-av-day="${day}"]:checked`).map(cb=>cb.dataset.avPeriod);
    if(selected.length) recurringAvailability[day]=selected;
  });
  const emp={
    ...(existing||{}), id,
    name:$('employeeName').value.trim(), active:$('employeeActive').checked,
    roles:[$('employeeRole').value],
    availabilityMode:$('employeeAvailabilityMode').value,
    recurringAvailability,
    flexibility:$('employeeFlexibility').value,
    minWeeklyHours:$('employeeMinHours').value===''?null:Number($('employeeMinHours').value),
    maxWeeklyHours:$('employeeMaxHours').value===''?null:Number($('employeeMaxHours').value),
    recurringAssignments:existing?.recurringAssignments||[],
    notes:$('employeeNotes').value.trim()
  };
  if(existing) Object.assign(existing,emp); else state.employees.push(emp);
  saveState(); renderAll(); $('employeeDialog').close();
  showToast('Employee saved');
}

function archiveEmployeeFromDialog(){
  const emp=employeeById($('employeeId').value); if(!emp) return;
  emp.active=!emp.active;
  saveState(); renderAll(); $('employeeDialog').close();
  showToast(emp.active?'Employee reactivated':'Employee archived');
}

function buildAvailabilityMatrixEdit(){
  const root=$('availabilityMatrixEdit');
  if(!root) return;
  root.innerHTML='<div></div><strong>AM</strong><strong>PM</strong>';
  DAYS.forEach(day=>{
    root.insertAdjacentHTML('beforeend',`<div class="dayname">${DAY_LABEL[day]}</div><label><input type="checkbox" data-av-edit-day="${day}" data-av-edit-period="AM"> AM</label><label><input type="checkbox" data-av-edit-day="${day}" data-av-edit-period="PM"> PM</label>`);
  });
}

function renderNormalAvailability(){
  const root=$('normalAvailabilityList');
  if(!root || !state) return;
  root.innerHTML='';
  const employees=state.employees.filter(e=>e.active);
  if(!employees.length){ root.innerHTML='<p>No active employees yet.</p>'; return; }
  employees.forEach(emp=>{
    const row=document.createElement('div');
    row.className='normal-availability-row';
    row.innerHTML=`
      <div class="normal-availability-main">
        <strong>${escapeHtml(emp.name)}</strong>
        <div class="list-row-sub">${escapeHtml(emp.availabilityMode==='weekly_variable'?'Weekly variable':'Recurring availability')} · ${escapeHtml(availabilitySummary(emp))}</div>
      </div>
      <button type="button">Edit Availability</button>`;
    row.querySelector('button').addEventListener('click',()=>openAvailabilityDialog(emp.id));
    root.appendChild(row);
  });
}

function openAvailabilityDialog(empId){
  const emp=employeeById(empId);
  if(!emp) return;
  if(!$('availabilityMatrixEdit')?.children.length) buildAvailabilityMatrixEdit();
  $('availabilityDialogTitle').textContent=`Edit ${emp.name}'s Availability`;
  $('availabilityEmployeeId').value=emp.id;
  $('availabilityModeEdit').value=emp.availabilityMode||'recurring';
  qsa('[data-av-edit-day]').forEach(cb=>{
    const tokens=emp.recurringAvailability?.[cb.dataset.avEditDay]||[];
    cb.checked=tokens.includes('ALL')||tokens.includes(cb.dataset.avEditPeriod);
  });
  $('availabilityDialog').showModal();
}

function saveAvailabilityFromDialog(e){
  e.preventDefault();
  const emp=employeeById($('availabilityEmployeeId').value);
  if(!emp) return;
  const recurringAvailability={};
  DAYS.forEach(day=>{
    const selected=qsa(`[data-av-edit-day="${day}"]:checked`).map(cb=>cb.dataset.avEditPeriod);
    if(selected.length) recurringAvailability[day]=selected;
  });
  emp.availabilityMode=$('availabilityModeEdit').value;
  emp.recurringAvailability=recurringAvailability;
  saveState();
  renderEmployees();
  renderNormalAvailability();
  $('availabilityDialog').close();
  showToast('Normal availability saved');
}

function renderExceptionEmployeeOptions(){
  const sel=$('exceptionEmployee');
  const current=sel.value;
  sel.innerHTML=state.employees.filter(e=>e.active).map(e=>`<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
  if([...sel.options].some(o=>o.value===current)) sel.value=current;
}

function addException(e){
  e.preventDefault();
  const startDate=$('exceptionStartDate')?.value || $('exceptionDate')?.value || '';
  const endDate=$('exceptionEndDate')?.value || startDate;
  if(!startDate || !endDate){ showToast('Choose a start and end date'); return; }
  if(endDate<startDate){ showToast('End date must be on or after start date'); return; }
  const employeeId=$('exceptionEmployee').value;
  const type=$('exceptionType').value;
  const start=$('exceptionStart').value;
  const end=$('exceptionEnd').value;
  const note=$('exceptionNote').value.trim();
  let date=startDate, count=0;
  while(date<=endDate && count<370){
    state.weeklyExceptions.push({
      id:uid('ex'), employeeId, date, type, start, end, note
    });
    date=addDays(date,1);
    count++;
  }
  saveState();
  renderExceptions();
  $('exceptionNote').value='';
  $('exceptionEndDate').value=startDate;
  showToast(count===1?'Temporary change saved':`Temporary change saved for ${count} days`);
}

function renderExceptions(){
  const root=$('exceptionList');
  const list=[...(state.weeklyExceptions||[])].sort((a,b)=>a.date.localeCompare(b.date));
  if(!list.length){ root.innerHTML='<p>No temporary changes saved yet.</p>'; return; }
  root.innerHTML='';
  list.forEach(ex=>{
    const emp=employeeById(ex.employeeId);
    const row=document.createElement('div'); row.className='list-row';
    row.innerHTML=`<div class="list-row-main"><div class="list-row-title">${escapeHtml(emp?.name||'Unknown')} · ${ex.type==='available'?'Available':'Unavailable'}</div><div class="list-row-sub">${fmtDate(ex.date)} · ${fmtTime(ex.start)}–${fmtTime(ex.end)}${ex.note?` · ${escapeHtml(ex.note)}`:''}</div></div><button type="button">Delete</button>`;
    row.querySelector('button').addEventListener('click',()=>{ state.weeklyExceptions=state.weeklyExceptions.filter(x=>x.id!==ex.id); saveState(); renderExceptions(); });
    root.appendChild(row);
  });
}

function renderCoverageRules(){
  const root=$('coverageRules'); root.innerHTML='';
  DAYS.forEach(day=>{
    const box=document.createElement('div'); box.className='coverage-day';
    box.innerHTML=`<h3>${DAY_LABEL[day]}</h3>`;
    const rules=state.coverageTemplates[day]||[];
    rules.forEach(r=>{
      const end=r.end==='CLOSE'?'Close':fmtTime(r.end);
      box.insertAdjacentHTML('beforeend',`<div class="coverage-row"><div><strong>${escapeHtml(r.label)}</strong><br><span class="list-row-sub">${roleLabel(r.role)}</span></div><div>${fmtTime(r.start)}</div><div>${end}</div><div class="coverage-required">${r.required?'Required':'Optional'}</div></div>`);
    });
    root.appendChild(box);
  });
}

function renderPriorityRules(){
  const root=$('priorityRules'); root.innerHTML='';
  (state.priorityRules||[]).forEach(rule=>{
    const card=document.createElement('div'); card.className='priority-card';
    card.innerHTML=`<strong>${escapeHtml(rule.label)}</strong><div class="list-row-sub">${roleLabel(rule.role)} · ${rule.days.map(d=>DAY_LABEL[d]).join(', ')}</div>`;
    rule.tiers.forEach((tier,tierIndex)=>{
      const line=document.createElement('div'); line.className='priority-tier';
      const label=document.createElement('span'); label.className='tier-label'; label.textContent=`Tier ${tierIndex+1}`; line.appendChild(label);
      tier.forEach(empId=>{
        const emp=employeeById(empId); if(!emp) return;
        const chip=document.createElement('span'); chip.className='priority-person';
        chip.append(document.createTextNode(emp.name));
        const up=document.createElement('button'); up.type='button'; up.textContent='▲'; up.title='Higher priority'; up.disabled=tierIndex===0;
        const down=document.createElement('button'); down.type='button'; down.textContent='▼'; down.title='Lower priority'; down.disabled=tierIndex===rule.tiers.length-1;
        up.addEventListener('click',()=>movePriority(rule.id,empId,tierIndex,tierIndex-1));
        down.addEventListener('click',()=>movePriority(rule.id,empId,tierIndex,tierIndex+1));
        chip.append(up,down); line.appendChild(chip);
      });
      card.appendChild(line);
    });
    root.appendChild(card);
  });
}

function movePriority(ruleId,empId,from,to){
  const rule=state.priorityRules.find(r=>r.id===ruleId); if(!rule||!rule.tiers[to]) return;
  rule.tiers[from]=rule.tiers[from].filter(id=>id!==empId); rule.tiers[to].push(empId);
  rule.tiers=rule.tiers.filter(t=>t.length);
  saveState(); renderPriorityRules(); showToast('Priority updated');
}

function addOverride(e){
  e.preventDefault();
  state.specialDateOverrides.push({id:uid('ov'),date:$('overrideDate').value,role:$('overrideRole').value,label:$('overrideLabel').value.trim(),start:$('overrideStart').value,end:$('overrideEnd').value,required:true});
  saveState(); renderOverrides(); showToast('Special coverage added');
}

function renderOverrides(){
  const root=$('overrideList'); const list=[...(state.specialDateOverrides||[])].sort((a,b)=>a.date.localeCompare(b.date));
  if(!list.length){ root.innerHTML='<p>No special-date coverage rules yet.</p>'; return; }
  root.innerHTML='';
  list.forEach(o=>{
    const row=document.createElement('div'); row.className='list-row';
    row.innerHTML=`<div class="list-row-main"><div class="list-row-title">${escapeHtml(o.label)} · ${roleLabel(o.role)}</div><div class="list-row-sub">${fmtDate(o.date)} · ${fmtTime(o.start)}–${fmtTime(o.end)}</div></div><button type="button">Delete</button>`;
    row.querySelector('button').addEventListener('click',()=>{state.specialDateOverrides=state.specialDateOverrides.filter(x=>x.id!==o.id);saveState();renderOverrides();});
    root.appendChild(row);
  });
}

function exportJson(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob); const a=document.createElement('a');
  a.href=url; a.download=`schedule-data-backup-${toISODate(new Date())}.json`; a.click(); URL.revokeObjectURL(url);
  showToast('JSON backup exported');
}

async function importJson(e){
  const file=e.target.files?.[0]; if(!file) return;
  try{
    const parsed=JSON.parse(await file.text());
    if(!parsed.meta || !Array.isArray(parsed.employees)) throw new Error('This does not look like a Schedule App database.');
    const count=parsed.employees.length;
    if(!confirm(`Import this database with ${count} employees? This replaces the working copy on this device.`)) return;
    state=parsed; normalizeState(); saveState(); renderAll(); currentSchedule=null; loadExistingOrGenerate(); showToast('Database imported');
  }catch(err){ alert(`Import failed: ${err.message}`); }
  finally{ e.target.value=''; }
}

async function resetBundled(){
  if(!confirm('Reload the bundled schedule-data.json and replace the working copy on this device?')) return;
  try{ state=await loadBundledData(); normalizeState(); saveState(); renderAll(); currentSchedule=null; loadExistingOrGenerate(); showToast('Bundled defaults reloaded'); }
  catch(err){ alert(err.message); }
}

function renderDataInfo(){
  if(!state || !$('dataInfo')) return;
  const active=state.employees.filter(e=>e.active).length;
  $('dataInfo').innerHTML=`<strong>Schema:</strong> ${escapeHtml(String(state.meta?.schemaVersion??'—'))}<br><strong>App data version:</strong> ${escapeHtml(state.meta?.appVersion||'—')}<br><strong>Employees:</strong> ${active} active / ${state.employees.length} total<br><strong>Saved weekly exceptions:</strong> ${state.weeklyExceptions.length}<br><strong>Saved schedule weeks:</strong> ${state.scheduleHistory.length}<br><strong>Last changed:</strong> ${state.meta?.updatedAt?new Date(state.meta.updatedAt).toLocaleString():'—'}`;
}

function mergedEmployeeShifts(schedule){
  const out=[];
  for(const emp of state.employees){
    const byDate={};
    (schedule.assignments||[]).filter(a=>a.employeeId===emp.id).forEach(a=>{
      const s=findSlot(a.slotId,schedule.slots); if(!s) return;
      (byDate[s.date] ||= []).push([minutes(s.start),minutes(s.end),s.role]);
    });
    for(const [date,ints] of Object.entries(byDate)){
      ints.sort((a,b)=>a[0]-b[0]);
      const merged=[];
      for(const [s,e,role] of ints){
        const last=merged[merged.length-1];
        if(last && s<=last.end && role===last.role) last.end=Math.max(last.end,e);
        else merged.push({start:s,end:e,role});
      }
      merged.forEach(m=>out.push({employee:emp.name,date,start:timeFromMinutes(m.start),end:timeFromMinutes(m.end),role:m.role}));
    }
  }
  return out.sort((a,b)=>a.date.localeCompare(b.date)||minutes(a.start)-minutes(b.start)||a.employee.localeCompare(b.employee));
}

async function shareSchedule(){
  if(!currentSchedule) return;
  const shifts=mergedEmployeeShifts(currentSchedule);
  const lines=[`El Mexican Restaurant schedule · week of ${fmtDate(currentSchedule.weekStart,{month:'short',day:'numeric',year:'numeric'})}`,''];
  DAYS.forEach((day,idx)=>{
    const date=addDays(currentSchedule.weekStart,idx); lines.push(`${DAY_LABEL[day]} ${fmtDate(date,{month:'short',day:'numeric'})}`);
    const dayShifts=shifts.filter(s=>s.date===date);
    if(dayShifts.length) dayShifts.forEach(s=>lines.push(`• ${s.employee}: ${fmtTime(s.start)}–${fmtTime(s.end)} · ${roleLabel(s.role)}`));
    else lines.push('• No assignments');
    lines.push('');
  });
  const text=lines.join('\n');
  try{
    if(navigator.share) await navigator.share({title:'Weekly Schedule',text});
    else { await navigator.clipboard.writeText(text); showToast('Schedule copied to clipboard'); }
  }catch(err){ if(err.name!=='AbortError') showToast('Could not share schedule'); }
}

function showToast(msg,duration=2200){
  const t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(showToast._timer); showToast._timer=setTimeout(()=>t.classList.remove('show'),duration);
}
function escapeHtml(s=''){ return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function registerServiceWorker(){
  if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
}

document.addEventListener('DOMContentLoaded',init);

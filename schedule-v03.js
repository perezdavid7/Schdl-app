/* Schedule App V0.3 — print grid, employee sharing, special-days calendar */
(function(){
  const V03='0.3.1';
  const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  let calendarCursor=null;

  // Extend database without changing the existing storage key.
  const baseNormalize=normalizeState;
  normalizeState=function(){
    baseNormalize();
    state.specialDays ||= [];
    state.specialDays.forEach(ev=>{
      if(!ev.staffingImpact){
        ev.staffingImpact = ev.busyLevel==='very_busy' ? 'extra_help'
          : (ev.busyLevel==='busy' || ev.busyLevel==='moderate') ? 'may_busier'
          : 'unknown';
      }
      if(typeof ev.reviewStaffing!=='boolean'){
        ev.reviewStaffing = typeof ev.remindExtraHelp==='boolean' ? ev.remindExtraHelp : true;
      }
    });
    state.meta ||= {};
    state.meta.appVersion=V03;
  };
  const baseEmpty=emptyState;
  emptyState=function(){
    const s=baseEmpty();
    s.specialDays=[];
    s.meta.appVersion=V03;
    return s;
  };

  // Keep special-day reminders in sync whenever the schedule redraws.
  const baseRenderSchedule=renderSchedule;
  renderSchedule=function(){
    baseRenderSchedule();
    renderSpecialWeekAlerts();
  };
  const baseRenderAll=renderAll;
  renderAll=function(){
    baseRenderAll();
    if(state){
      state.specialDays ||= [];
      renderSpecialDaysList();
      renderCalendar();
    }
  };

  function boot(){
    if(!state){ setTimeout(boot,80); return; }
    state.specialDays ||= [];
    state.meta.appVersion=V03;
    saveState();
    wirePrintAndShare();
    wireCalendar();
    renderSpecialDaysList();
    renderCalendar();
    renderSpecialWeekAlerts();
  }

  function wirePrintAndShare(){
    const oldPrint=$('printBtn');
    if(oldPrint){
      const btn=oldPrint.cloneNode(true);
      oldPrint.replaceWith(btn);
      btn.addEventListener('click',printWeeklyGrid);
    }
    const oldShare=$('shareBtn');
    if(oldShare){
      const btn=oldShare.cloneNode(true);
      btn.textContent='Share Employee';
      oldShare.replaceWith(btn);
      btn.addEventListener('click',openShareEmployeeDialog);
    }
    $('closeShareEmployeeDialog')?.addEventListener('click',()=>$('shareEmployeeDialog').close());
    $('shareAllEmployeesBtn')?.addEventListener('click',shareAllGrouped);
  }

  function getWeekShifts(){
    return currentSchedule ? mergedEmployeeShifts(currentSchedule) : [];
  }

  function shiftText(s){
    return `${fmtTime(s.start)}–${fmtTime(s.end)}`;
  }

  function employeeWeekText(empName){
    const shifts=getWeekShifts().filter(s=>s.employee===empName);
    const lines=[
      'El Mexican Restaurant',
      `${empName} — week of ${fmtDate(currentSchedule.weekStart,{month:'short',day:'numeric',year:'numeric'})}`,
      ''
    ];
    DAYS.forEach((day,idx)=>{
      const date=addDays(currentSchedule.weekStart,idx);
      const dayShifts=shifts.filter(s=>s.date===date);
      if(!dayShifts.length){
        lines.push(`${DAY_LABEL[day]}: OFF`);
      }else{
        lines.push(`${DAY_LABEL[day]}: ${dayShifts.map(shiftText).join(' / ')}`);
      }
    });
    return lines.join('\n');
  }

  function openShareEmployeeDialog(){
    if(!currentSchedule){ showToast('Generate a schedule first'); return; }
    const root=$('shareEmployeeList');
    root.innerHTML='';
    const shifts=getWeekShifts();
    const names=[...new Set(shifts.map(s=>s.employee))];
    state.employees.filter(e=>e.active && names.includes(e.name)).forEach(emp=>{
      const row=document.createElement('div');
      row.className='share-employee-row';
      const detail=shifts.filter(s=>s.employee===emp.name)
        .map(s=>`${fmtDate(s.date,{weekday:'short'})} ${shiftText(s)}`).join(' · ');
      row.innerHTML=`<div><strong>${escapeHtml(emp.name)}</strong><div class="list-row-sub">${escapeHtml(detail)}</div></div>`;
      const btn=document.createElement('button');
      btn.type='button'; btn.textContent='Share';
      btn.addEventListener('click',()=>shareOneEmployee(emp.name));
      row.appendChild(btn);
      root.appendChild(row);
    });
    if(!root.children.length) root.innerHTML='<p>No employee assignments in this schedule yet.</p>';
    $('shareEmployeeDialog').showModal();
  }

  async function shareText(title,text){
    try{
      if(navigator.share) await navigator.share({title,text});
      else{
        await navigator.clipboard.writeText(text);
        showToast('Schedule copied to clipboard');
      }
    }catch(err){
      if(err?.name!=='AbortError') showToast('Could not share schedule');
    }
  }

  async function shareOneEmployee(empName){
    if(!currentSchedule) return;
    await shareText(`${empName} schedule`,employeeWeekText(empName));
  }

  async function shareAllGrouped(){
    if(!currentSchedule) return;
    const shifts=getWeekShifts();
    const names=[...new Set(shifts.map(s=>s.employee))];
    const blocks=names.map(name=>employeeWeekText(name));
    await shareText('Weekly Schedule',blocks.join('\n\n----------------\n\n'));
  }

  function printWeeklyGrid(){
    if(!currentSchedule){ showToast('Generate a schedule first'); return; }
    const shifts=getWeekShifts();
    const employees=state.employees.filter(e=>e.active);
    const rows=employees.map(emp=>{
      const cells=DAYS.map((day,idx)=>{
        const date=addDays(currentSchedule.weekStart,idx);
        const list=shifts.filter(s=>s.employee===emp.name && s.date===date);
        const val=list.map(shiftText).join('<br>');
        return `<td>${val||''}</td>`;
      }).join('');
      return `<tr><th scope="row">${escapeHtml(emp.name)}</th>${cells}</tr>`;
    }).join('');
    const headers=DAYS.map((day,idx)=>{
      const date=addDays(currentSchedule.weekStart,idx);
      return `<th>${DAY_LABEL[day]}<span>${fmtDate(date,{month:'numeric',day:'numeric'})}</span></th>`;
    }).join('');

    const w=window.open('','_blank');
    if(!w){ showToast('Allow pop-ups to print the schedule'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Weekly Schedule</title>
      <style>
      @page{size:landscape;margin:.35in}
      *{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0}
      h1{text-align:center;margin:0 0 3px;font-size:24px}p{text-align:center;margin:0 0 12px;font-size:12px}
      table{width:100%;border-collapse:collapse;table-layout:fixed}
      th,td{border:1.5px solid #333;text-align:center;vertical-align:middle;padding:6px 4px;height:54px;font-size:12px}
      thead th{font-weight:800;background:#f3f4f6;height:42px}
      thead th:first-child{width:15%}tbody th{text-align:left;padding-left:8px;font-size:13px;width:15%}
      thead span{display:block;font-size:9px;font-weight:500;margin-top:2px;color:#444}
      .note{font-size:9px;text-align:left;margin-top:8px;color:#555}
      </style></head><body>
      <h1>Weekly Schedule</h1>
      <p>El Mexican Restaurant · Week of ${fmtDate(currentSchedule.weekStart,{month:'long',day:'numeric',year:'numeric'})}</p>
      <table><thead><tr><th>Name</th>${headers}</tr></thead><tbody>${rows}</tbody></table>
      <div class="note">Times shown are scheduled work hours.</div>
      <script>window.onload=()=>{setTimeout(()=>window.print(),150)}<\/script>
      </body></html>`);
    w.document.close();
  }

  function wireCalendar(){
    $('calendarPrev')?.addEventListener('click',()=>{ moveCalendar(-1); });
    $('calendarNext')?.addEventListener('click',()=>{ moveCalendar(1); });
    $('addSpecialDayBtn')?.addEventListener('click',()=>openSpecialDayDialog());
    $('closeSpecialDayDialog')?.addEventListener('click',()=>$('specialDayDialog').close());
    $('specialDayForm')?.addEventListener('submit',saveSpecialDay);
    $('deleteSpecialDayBtn')?.addEventListener('click',deleteSpecialDay);
    $('specialDayDate')?.addEventListener('change',()=>{
      if($('specialDayDate').value) calendarCursor=fromISODate($('specialDayDate').value);
    });
    calendarCursor=new Date();
    calendarCursor.setDate(1);
  }

  function moveCalendar(delta){
    if(!calendarCursor){ calendarCursor=new Date(); calendarCursor.setDate(1); }
    calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+delta,1,12);
    renderCalendar();
  }

  function renderCalendar(){
    const root=$('specialCalendar');
    if(!root || !state) return;
    state.specialDays ||= [];
    if(!calendarCursor){ calendarCursor=new Date(); calendarCursor.setDate(1); }
    const y=calendarCursor.getFullYear(), m=calendarCursor.getMonth();
    $('calendarMonthLabel').textContent=`${MONTHS[m]} ${y}`;
    root.innerHTML='';
    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(x=>{
      const h=document.createElement('div'); h.className='calendar-dow'; h.textContent=x; root.appendChild(h);
    });
    const first=new Date(y,m,1,12).getDay();
    const days=new Date(y,m+1,0,12).getDate();
    for(let i=0;i<first;i++){
      const blank=document.createElement('div'); blank.className='calendar-cell empty'; root.appendChild(blank);
    }
    for(let d=1;d<=days;d++){
      const date=toISODate(new Date(y,m,d,12));
      const events=(state.specialDays||[]).filter(x=>x.date===date);
      const cover=(state.specialDateOverrides||[]).filter(x=>x.date===date);
      const cell=document.createElement('button'); cell.type='button'; cell.className='calendar-cell';
      cell.innerHTML=`<span class="calendar-number">${d}</span>`;
      if(events.length){
        const dots=document.createElement('div'); dots.className='calendar-events';
        events.slice(0,2).forEach(ev=>{
          const tag=document.createElement('span'); tag.className=`calendar-tag impact-${ev.staffingImpact||'unknown'}`; tag.textContent=ev.label; dots.appendChild(tag);
        });
        if(events.length>2){ const more=document.createElement('span'); more.className='calendar-more'; more.textContent=`+${events.length-2} more`; dots.appendChild(more); }
        cell.appendChild(dots);
      }else if(cover.length){
        const dots=document.createElement('div'); dots.className='calendar-events';
        const tag=document.createElement('span'); tag.className='calendar-tag coverage'; tag.textContent='Extra coverage'; dots.appendChild(tag); cell.appendChild(dots);
      }
      cell.addEventListener('click',()=>{
        if(events.length===1) openSpecialDayDialog(events[0].id);
        else openSpecialDayDialog('',date);
      });
      root.appendChild(cell);
    }
  }

  function openSpecialDayDialog(id='',date=''){
    const ev=(state.specialDays||[]).find(x=>x.id===id)||null;
    $('specialDayDialogTitle').textContent=ev?'Edit Special Day':'Add Special Day';
    $('specialDayId').value=ev?.id||'';
    $('specialDayDate').value=ev?.date||date||toISODate(new Date());
    $('specialDayLabel').value=ev?.label||'';
    $('specialDayStaffingImpact').value=ev?.staffingImpact||'unknown';
    $('specialDayReviewStaffing').checked=ev ? ev.reviewStaffing!==false : true;
    $('specialDayNote').value=ev?.note||'';
    $('deleteSpecialDayBtn').classList.toggle('hidden',!ev);
    $('specialDayDialog').showModal();
  }

  function saveSpecialDay(e){
    e.preventDefault();
    const id=$('specialDayId').value||uid('special');
    const ev={
      id,
      date:$('specialDayDate').value,
      label:$('specialDayLabel').value.trim(),
      staffingImpact:$('specialDayStaffingImpact').value,
      reviewStaffing:$('specialDayReviewStaffing').checked,
      note:$('specialDayNote').value.trim()
    };
    const idx=state.specialDays.findIndex(x=>x.id===id);
    if(idx>=0) state.specialDays[idx]=ev; else state.specialDays.push(ev);
    state.specialDays.sort((a,b)=>a.date.localeCompare(b.date));
    calendarCursor=fromISODate(ev.date); calendarCursor.setDate(1);
    saveState(); renderSpecialDaysList(); renderCalendar(); renderSpecialWeekAlerts();
    $('specialDayDialog').close();
    showToast('Special day saved');
  }

  function deleteSpecialDay(){
    const id=$('specialDayId').value;
    if(!id || !confirm('Delete this special day?')) return;
    state.specialDays=state.specialDays.filter(x=>x.id!==id);
    saveState(); renderSpecialDaysList(); renderCalendar(); renderSpecialWeekAlerts();
    $('specialDayDialog').close(); showToast('Special day deleted');
  }

  function renderSpecialDaysList(){
    const root=$('specialDaysList');
    if(!root || !state) return;
    const today=toISODate(new Date());
    const list=(state.specialDays||[]).filter(x=>x.date>=today).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,12);
    if(!list.length){ root.innerHTML='<p>No upcoming special days yet.</p>'; return; }
    root.innerHTML='';
    list.forEach(ev=>{
      const row=document.createElement('div'); row.className='special-day-row';
      row.innerHTML=`<div><strong>${escapeHtml(ev.label)}</strong><div class="list-row-sub">${fmtDate(ev.date,{weekday:'short',month:'short',day:'numeric'})} · ${impactLabel(ev.staffingImpact)}${ev.reviewStaffing?' · Staffing review reminder':''}</div>${ev.note?`<div class="special-note">${escapeHtml(ev.note)}</div>`:''}</div>`;
      const actions=document.createElement('div'); actions.className='special-actions';
      const cover=document.createElement('button'); cover.type='button'; cover.textContent='Add Coverage';
      cover.addEventListener('click',()=>prefillCoverage(ev));
      const edit=document.createElement('button'); edit.type='button'; edit.textContent='Edit'; edit.addEventListener('click',()=>openSpecialDayDialog(ev.id));
      actions.append(cover,edit); row.appendChild(actions); root.appendChild(row);
    });
  }

  function impactLabel(impact){
    return ({
      unknown:'Unknown / review later',
      normal:'Normal staffing',
      slower:'May be slower',
      may_busier:'May be busier',
      extra_help:'Extra help likely needed',
      custom:'Custom staffing'
    })[impact]||'Unknown / review later';
  }

  function prefillCoverage(ev){
    // Switch to Rules and prefill the existing special-date coverage form.
    qsa('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab==='rules'));
    qsa('.tab-panel').forEach(p=>p.classList.remove('active'));
    $('tab-rules')?.classList.add('active');
    $('overrideDate').value=ev.date;
    $('overrideLabel').value=`${ev.label} extra coverage`;
    $('overrideStart').value='16:30';
    const day=DAYS[(fromISODate(ev.date).getDay()+6)%7];
    $('overrideEnd').value=state.businessHours?.[day]?.close||'20:00';
    $('overrideRole').value='dish_runner';
    $('overrideDate').scrollIntoView({behavior:'smooth',block:'center'});
    showToast('Special coverage form is ready');
  }

  function renderSpecialWeekAlerts(){
    if(!currentSchedule || !state) return;
    let root=$('specialDayAlerts');
    if(!root){
      root=document.createElement('div'); root.id='specialDayAlerts'; root.className='alerts';
      const stats=$('scheduleStats');
      stats?.insertAdjacentElement('afterend',root);
    }
    root.innerHTML='';
    const start=currentSchedule.weekStart, end=addDays(start,6);
    const events=(state.specialDays||[]).filter(x=>x.date>=start && x.date<=end);
    events.forEach(ev=>{
      const hasCoverage=(state.specialDateOverrides||[]).some(x=>x.date===ev.date);
      const div=document.createElement('div');
      const needsExtra=ev.staffingImpact==='extra_help';
      div.className=`alert ${ev.reviewStaffing?'warn':'ok'}`;
      let status=`${impactLabel(ev.staffingImpact)}.`;
      if(ev.reviewStaffing) status += ' Reminder: review staffing for this day.';
      if(hasCoverage) status += ' Extra coverage has already been added.';
      div.innerHTML=`<strong>${escapeHtml(ev.label)}</strong> — ${fmtDate(ev.date,{weekday:'long',month:'short',day:'numeric'})}. ${escapeHtml(status)}`;
      if(needsExtra && !hasCoverage){
        const btn=document.createElement('button'); btn.type='button'; btn.className='alert-action'; btn.textContent='Add coverage';
        btn.addEventListener('click',()=>prefillCoverage(ev));
        div.appendChild(btn);
      }
      root.appendChild(div);
    });
  }

  document.addEventListener('DOMContentLoaded',boot);
})();
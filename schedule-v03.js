/* Schedule App V0.3 — print grid, employee sharing, special-days calendar */
(function(){
  const V03='0.5.5';
  const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  let calendarCursor=null;

  function isoYmd(year,monthIndex,day){
    return `${year}-${String(monthIndex+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  function nthWeekday(year,monthIndex,weekday,nth){
    const first=new Date(year,monthIndex,1,12);
    const day=1+((7+weekday-first.getDay())%7)+(nth-1)*7;
    return isoYmd(year,monthIndex,day);
  }
  function lastWeekday(year,monthIndex,weekday){
    const last=new Date(year,monthIndex+1,0,12);
    const day=last.getDate()-((7+last.getDay()-weekday)%7);
    return isoYmd(year,monthIndex,day);
  }
  function thanksgivingDate(year){ return nthWeekday(year,10,4,4); }

  function usFederalHolidays(year){
    return [
      {key:'new_year',date:isoYmd(year,0,1),label:"New Year's Day"},
      {key:'mlk',date:nthWeekday(year,0,1,3),label:'Martin Luther King Jr. Day'},
      {key:'presidents',date:nthWeekday(year,1,1,3),label:"Presidents Day"},
      {key:'memorial',date:lastWeekday(year,4,1),label:'Memorial Day'},
      {key:'juneteenth',date:isoYmd(year,5,19),label:'Juneteenth'},
      {key:'independence',date:isoYmd(year,6,4),label:'Independence Day'},
      {key:'labor',date:nthWeekday(year,8,1,1),label:'Labor Day'},
      {key:'columbus',date:nthWeekday(year,9,1,2),label:'Columbus Day'},
      {key:'veterans',date:isoYmd(year,10,11),label:'Veterans Day'},
      {key:'thanksgiving',date:thanksgivingDate(year),label:'Thanksgiving Day'},
      {key:'christmas',date:isoYmd(year,11,25),label:'Christmas Day'}
    ].map(h=>({
      id:`system_holiday_${year}_${h.key}`,
      date:h.date,
      label:h.label,
      category:'national_holiday',
      staffingImpact:'unknown',
      reviewStaffing:true,
      note:'Automatic U.S. federal holiday',
      system:true
    }));
  }

  function recurringLocalEvents(year){
    return [{
      id:`system_local_${year}_gobble_gait`,
      date:thanksgivingDate(year),
      label:'Gobble Gait',
      category:'local_event',
      staffingImpact:'custom',
      reviewStaffing:true,
      note:'Thanksgiving morning event in front of the restaurant.',
      system:true
    }];
  }

  function systemEventsForYear(year){
    return [...usFederalHolidays(year),...recurringLocalEvents(year)];
  }
  function calendarEventsForDate(date){
    const year=Number(date.slice(0,4));
    const custom=(state.specialDays||[]).filter(x=>x.date===date);
    const system=systemEventsForYear(year).filter(x=>x.date===date);
    return [...system,...custom];
  }
  function calendarEventsBetween(start,end){
    const y1=Number(start.slice(0,4)), y2=Number(end.slice(0,4));
    const system=[];
    for(let y=y1;y<=y2;y++) system.push(...systemEventsForYear(y));
    return [...system,...(state.specialDays||[])]
      .filter(x=>x.date>=start && x.date<=end)
      .sort((a,b)=>a.date.localeCompare(b.date)||a.label.localeCompare(b.label));
  }
  function categoryLabel(category){
    return ({
      national_holiday:'U.S. holiday',
      local_event:'Local event',
      holiday:'Holiday / observance',
      other:'Other special day'
    })[category]||'Special day';
  }

  // Extend database without changing the existing storage key.
  const baseNormalize=normalizeState;
  normalizeState=function(){
    baseNormalize();
    state.specialDays ||= [];
    // Remove the one-time demo event accidentally saved during testing.
    state.specialDays = state.specialDays.filter(ev=>{
      const label=String(ev.label||'').toLowerCase().replace(/[^a-z]/g,'');
      return !(ev.date==='2026-09-23' && label.includes('cincodmayo'));
    });
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
    if(currentSchedule){
      const before=currentSchedule.assignments.length;
      currentSchedule.assignments=currentSchedule.assignments.filter(a=>{
        const slot=currentSchedule.slots.find(s=>s.id===a.slotId);
        if(!slot || slot.required) return true;
        return a.source==='fixed' || a.source==='manual';
      });
      if(currentSchedule.assignments.length!==before) saveScheduleToHistory(currentSchedule);
    }
    baseRenderSchedule();
    addWeeklyShiftButtons();
    renderMobileWeekView();
    renderSpecialWeekAlerts();
  };
  const baseRenderAll=renderAll;
  renderAll=function(){
    baseRenderAll();
    if(state){
      state.specialDays ||= [];
      renderSpecialDaysList();
      renderCalendar();
      renderNormalAvailability();
    }
  };

  function boot(){
    if(!state){ setTimeout(boot,80); return; }
    state.specialDays ||= [];
    state.meta.appVersion=V03;
    saveState();
    wirePrintAndShare();
    wireCalendar();
    wireAvailability();
    wireWeeklyFlow();
    wireWeeklyShiftDialog();
    renderSpecialDaysList();
    renderCalendar();
    renderNormalAvailability();
    renderSpecialWeekAlerts();
  }

  function wireAvailability(){
    $('closeAvailabilityDialog')?.addEventListener('click',()=>$('availabilityDialog').close());
    $('availabilityForm')?.addEventListener('submit',saveNormalAvailability);
    buildAvailabilityEditMatrix();
  }

  function buildAvailabilityEditMatrix(){
    const root=$('availabilityMatrixEdit');
    if(!root) return;
    root.innerHTML='<div></div><strong>AM</strong><strong>PM</strong>';
    DAYS.forEach(day=>{
      root.insertAdjacentHTML('beforeend',`<div class="dayname">${DAY_LABEL[day]}</div><label><input type="checkbox" data-edit-av-day="${day}" data-edit-av-period="AM"> AM</label><label><input type="checkbox" data-edit-av-day="${day}" data-edit-av-period="PM"> PM</label>`);
    });
  }

  function renderNormalAvailability(){
    const root=$('normalAvailabilityList');
    if(!root || !state) return;
    root.innerHTML='';
    const employees=state.employees.filter(e=>e.active);
    if(!employees.length){
      root.innerHTML='<p>No active employees yet.</p>';
      return;
    }
    employees.forEach(emp=>{
      const row=document.createElement('div');
      row.className='normal-availability-row';
      const summary=availabilitySummary(emp);
      row.innerHTML=`<div class="normal-availability-main"><strong>${escapeHtml(emp.name)}</strong><div class="list-row-sub">${escapeHtml(summary)}</div></div>`;
      const btn=document.createElement('button');
      btn.type='button';
      btn.textContent='Edit Availability';
      btn.addEventListener('click',()=>openAvailabilityDialog(emp.id));
      row.appendChild(btn);
      root.appendChild(row);
    });
  }

  function openAvailabilityDialog(empId){
    const emp=employeeById(empId);
    if(!emp) return;
    $('availabilityDialogTitle').textContent=`${emp.name} Availability`;
    $('availabilityEmployeeId').value=emp.id;
    $('availabilityModeEdit').value=emp.availabilityMode||'recurring';
    qsa('[data-edit-av-day]').forEach(cb=>{
      const tokens=emp.recurringAvailability?.[cb.dataset.editAvDay]||[];
      cb.checked=tokens.includes('ALL')||tokens.includes(cb.dataset.editAvPeriod);
    });
    $('availabilityDialog').showModal();
  }

  function saveNormalAvailability(e){
    e.preventDefault();
    const emp=employeeById($('availabilityEmployeeId').value);
    if(!emp) return;
    const recurringAvailability={};
    DAYS.forEach(day=>{
      const selected=qsa(`[data-edit-av-day="${day}"]:checked`).map(cb=>cb.dataset.editAvPeriod);
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

  function wireWeeklyShiftDialog(){
    $('closeWeeklyShiftDialog')?.addEventListener('click',()=>$('weeklyShiftDialog').close());
    $('closeWeeklyShiftDialogBottom')?.addEventListener('click',()=>$('weeklyShiftDialog').close());
    $('weeklyShiftForm')?.addEventListener('submit',saveWeeklyShift);
  }

  function addWeeklyShiftButtons(){
    if(!currentSchedule) return;
    const cards=[...$('scheduleGrid').querySelectorAll('.day-card')];
    cards.forEach((card,idx)=>{
      const head=card.querySelector('.day-head');
      if(!head || head.querySelector('.add-weekly-shift')) return;
      const date=addDays(currentSchedule.weekStart,idx);
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='add-weekly-shift';
      btn.textContent='+ Add Shift';
      btn.addEventListener('click',()=>openWeeklyShiftDialog(date));
      head.appendChild(btn);
    });
  }

  function openWeeklyShiftDialog(date){
    if(!currentSchedule) return;
    $('weeklyShiftDate').value=date;
    $('weeklyShiftLabel').value='';
    $('weeklyShiftRole').value='dish_runner';
    $('weeklyShiftStart').value='16:30';
    const day=DAYS[(fromISODate(date).getDay()+6)%7];
    $('weeklyShiftEnd').value=state.businessHours?.[day]?.close || '20:00';
    $('weeklyShiftRequired').checked=true;
    $('weeklyShiftDialog').showModal();
  }

  function saveWeeklyShift(e){
    e.preventDefault();
    if(!currentSchedule) return;
    const date=$('weeklyShiftDate').value;
    const start=$('weeklyShiftStart').value;
    const end=$('weeklyShiftEnd').value;
    if(!date || !start || !end){ showToast('Choose a date and shift time'); return; }
    if(minutes(end)<=minutes(start)){ showToast('Shift end must be after start'); return; }

    const id=uid('ov');
    const role=$('weeklyShiftRole').value;
    const label=$('weeklyShiftLabel').value.trim() || (role==='server'?'Extra server':'Dishwasher / Runner');
    const required=$('weeklyShiftRequired').checked;
    const override={id,date,role,label,start,end,required};
    state.specialDateOverrides ||= [];
    state.specialDateOverrides.push(override);
    saveState();

    const day=DAYS[(fromISODate(date).getDay()+6)%7];
    currentSchedule.slots.push({
      id:`${date}:override:${id}`,
      templateId:`override:${id}`,
      date,day,role,label,start,end,required,source:'override'
    });
    currentSchedule.slots.sort((a,b)=>a.date.localeCompare(b.date)||minutes(a.start)-minutes(b.start)||a.role.localeCompare(b.role));
    saveScheduleToHistory(currentSchedule);
    $('weeklyShiftDialog').close();
    renderSchedule();
    showToast(required?'Required shift added — assign someone to cover it':'Optional shift added');
  }

  let mobileSelectedDay=0;
  let mobileWeekStart='';

  function renderMobileWeekView(){
    const grid=$('scheduleGrid');
    if(!grid || !currentSchedule) return;

    if(mobileWeekStart!==currentSchedule.weekStart){
      mobileWeekStart=currentSchedule.weekStart;
      const today=toISODate(new Date());
      mobileSelectedDay=(today>=currentSchedule.weekStart && today<=addDays(currentSchedule.weekStart,6))
        ? Math.max(0,Math.min(6,Math.round((fromISODate(today)-fromISODate(currentSchedule.weekStart))/86400000)))
        : 0;
    }

    let strip=$('mobileWeekStrip');
    if(!strip){
      strip=document.createElement('div');
      strip.id='mobileWeekStrip';
      strip.className='mobile-week-strip';
      strip.setAttribute('aria-label','Week days');
      grid.insertAdjacentElement('beforebegin',strip);
    }

    strip.innerHTML='';
    const cards=[...grid.querySelectorAll('.day-card')];
    DAYS.forEach((day,idx)=>{
      const date=addDays(currentSchedule.weekStart,idx);
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='mobile-week-day';
      btn.dataset.dayIndex=String(idx);
      btn.setAttribute('aria-selected',idx===mobileSelectedDay?'true':'false');
      btn.innerHTML=`<span class="mobile-week-name">${DAY_LABEL[day].slice(0,3)}</span><span class="mobile-week-date">${fmtDate(date,{month:'numeric',day:'numeric'})}</span>`;
      btn.addEventListener('click',()=>{
        mobileSelectedDay=idx;
        renderMobileWeekView();
      });
      strip.appendChild(btn);
    });

    const compact=window.matchMedia('(max-width: 900px)').matches;
    grid.classList.toggle('mobile-day-view',compact);
    cards.forEach((card,idx)=>card.classList.toggle('mobile-active',!compact || idx===mobileSelectedDay));
  }

  window.addEventListener('resize',()=>{
    if(currentSchedule) renderMobileWeekView();
  });

  let weeklyFlowActive=false;
  let weeklyFlowStep=0;
  const WEEKLY_FLOW_STEPS=[
    {
      tab:'employees',
      title:'Employees',
      text:'Confirm everyone who may work this week is listed and active. Add, edit, archive, or reactivate employees as needed.',
      target:'employeeList'
    },
    {
      tab:'availability',
      title:'Normal Availability',
      text:'Review each employee\'s usual availability. Fix anything that is not correct before moving on.',
      target:'normalAvailabilityList'
    },
    {
      tab:'availability',
      title:'Requested Time Off',
      text:'Enter any requested day off, vacation, appointment, school conflict, or other temporary availability change for this week. If nobody requested time off, just tap Next.',
      target:'exceptionForm'
    },
    {
      tab:'calendar',
      title:'Special Days & Events',
      text:'Review holidays and local events that fall during this week and decide whether staffing needs to change.',
      target:'specialDaysList'
    },
    {
      tab:'schedule',
      title:'Generate Schedule',
      text:'Everything for the week has been reviewed. Generate the schedule using the current employees, availability, time off, coverage rules, and priorities.',
      target:'scheduleGrid',
      action:'generate'
    },
    {
      tab:'schedule',
      title:'Review Schedule',
      text:'Check uncovered shifts, guaranteed hours, and each day. Make any manual assignment changes before continuing.',
      target:'alerts'
    },
    {
      tab:'schedule',
      title:'Output & Share',
      text:'Share the printable schedule to the work computer, or share each employee\'s individual schedule. Finish when the week is ready.',
      target:'printBtn',
      action:'finish'
    }
  ];

  function wireWeeklyFlow(){
    const oldGenerate=$('generateBtn');
    if(oldGenerate){
      const btn=oldGenerate.cloneNode(true);
      oldGenerate.replaceWith(btn);
      btn.textContent='Start Weekly Setup';
      btn.addEventListener('click',startWeeklyFlow);
    }
    $('weeklyFlowBack')?.addEventListener('click',()=>moveWeeklyFlow(-1));
    $('weeklyFlowNext')?.addEventListener('click',handleWeeklyFlowNext);
    $('weeklyFlowExit')?.addEventListener('click',()=>endWeeklyFlow(false));
  }

  function startWeeklyFlow(){
    const today=toISODate(new Date());
    const currentMonday=mondayOf(today);
    const nextMonday=addDays(currentMonday,7);
    const selected=$('weekDate')?.value || '';

    // Weekly setup is for the upcoming schedule. If the picker is still on
    // the app's normal current-week default, advance it to next week.
    const weekStart=(!selected || selected===currentMonday)
      ? nextMonday
      : mondayOf(selected);

    $('weekDate').value=weekStart;
    weeklyFlowActive=true;
    weeklyFlowStep=0;
    const end=addDays(weekStart,6);
    if($('exceptionStartDate')) $('exceptionStartDate').value=weekStart;
    if($('exceptionEndDate')) $('exceptionEndDate').value=end;
    if($('exceptionType')) $('exceptionType').value='unavailable';
    renderWeeklyFlow();
  }

  function endWeeklyFlow(done=true){
    weeklyFlowActive=false;
    $('weeklyFlowBar')?.classList.add('hidden');
    qsa('.wizard-focus').forEach(x=>x.classList.remove('wizard-focus'));
    const btn=$('generateBtn');
    if(btn) btn.textContent='Start Weekly Setup';
    if(done) showToast('Weekly schedule setup complete');
  }

  function moveWeeklyFlow(delta){
    weeklyFlowStep=Math.max(0,Math.min(WEEKLY_FLOW_STEPS.length-1,weeklyFlowStep+delta));
    renderWeeklyFlow();
  }

  function activateFlowTab(name){
    qsa('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===name));
    qsa('.tab-panel').forEach(p=>p.classList.remove('active'));
    $('tab-'+name)?.classList.add('active');
  }

  function requiredScheduleGaps(){
    if(!currentSchedule) return [];
    return currentSchedule.slots.filter(slot=>
      slot.required && !currentSchedule.assignments.some(a=>a.slotId===slot.id)
    );
  }

  function requiredGapSummary(gaps){
    return gaps.slice(0,6).map(slot=>
      `${DAY_LABEL[slot.day]} ${fmtTime(slot.start)}–${fmtTime(slot.end)} · ${slot.label}`
    ).join('\n');
  }

  function handleWeeklyFlowNext(){
    const step=WEEKLY_FLOW_STEPS[weeklyFlowStep];
    if(step.action==='generate'){
      generateAndRender();
      weeklyFlowStep=Math.min(WEEKLY_FLOW_STEPS.length-1,weeklyFlowStep+1);
      setTimeout(renderWeeklyFlow,60);
      return;
    }

    if(weeklyFlowStep===5){
      const gaps=requiredScheduleGaps();
      if(gaps.length){
        const extra=gaps.length>6 ? `\n…and ${gaps.length-6} more required gap${gaps.length-6===1?'':'s'}.` : '';
        const proceed=confirm(
          `There ${gaps.length===1?'is':'are'} ${gaps.length} required uncovered shift${gaps.length===1?'':'s'}:\n\n${requiredGapSummary(gaps)}${extra}\n\nContinue to Output & Share with these gaps still open?`
        );
        if(!proceed){
          showToast('Finish the required gaps before continuing');
          return;
        }
      }
    }

    if(step.action==='finish'){
      const gaps=requiredScheduleGaps();
      if(gaps.length){
        const proceed=confirm(
          `This schedule still has ${gaps.length} required uncovered shift${gaps.length===1?'':'s'}. Finish the weekly setup anyway?`
        );
        if(!proceed){
          weeklyFlowStep=5;
          renderWeeklyFlow();
          return;
        }
      }
      endWeeklyFlow(true);
      return;
    }
    moveWeeklyFlow(1);
  }

  function renderWeeklyFlow(){
    const bar=$('weeklyFlowBar');
    if(!bar || !weeklyFlowActive) return;
    const step=WEEKLY_FLOW_STEPS[weeklyFlowStep];
    const weekStart=$('weekDate')?.value || mondayOf(toISODate(new Date()));
    const weekEnd=addDays(weekStart,6);

    bar.classList.remove('hidden');
    $('weeklyFlowCount').textContent=`Step ${weeklyFlowStep+1} of ${WEEKLY_FLOW_STEPS.length}`;
    $('weeklyFlowTitle').textContent=step.title;
    $('weeklyFlowText').textContent=step.text;
    $('weeklyFlowWeek').textContent=`${fmtDate(weekStart,{month:'short',day:'numeric'})} – ${fmtDate(weekEnd,{month:'short',day:'numeric',year:'numeric'})}`;

    const progress=$('weeklyFlowProgress');
    progress.innerHTML='';
    WEEKLY_FLOW_STEPS.forEach((s,idx)=>{
      const item=document.createElement('span');
      item.className='weekly-flow-dot'+(idx<weeklyFlowStep?' done':idx===weeklyFlowStep?' active':'');
      item.textContent=String(idx+1);
      item.title=s.title;
      progress.appendChild(item);
    });

    $('weeklyFlowBack').disabled=weeklyFlowStep===0;
    const next=$('weeklyFlowNext');
    next.textContent=step.action==='generate' ? 'Generate Schedule'
      : step.action==='finish' ? 'Finish'
      : 'Next';

    activateFlowTab(step.tab);
    qsa('.wizard-focus').forEach(x=>x.classList.remove('wizard-focus'));
    const target=$(step.target);
    target?.classList.add('wizard-focus');

    if(weeklyFlowStep===2){
      if($('exceptionStartDate') && !$('exceptionStartDate').value) $('exceptionStartDate').value=weekStart;
      if($('exceptionEndDate') && !$('exceptionEndDate').value) $('exceptionEndDate').value=weekEnd;
    }

    if(weeklyFlowStep===3){
      const events=calendarEventsBetween(weekStart,weekEnd);
      if(events.length){
        $('weeklyFlowText').textContent=`${step.text} This week currently has ${events.length} calendar event${events.length===1?'':'s'} to review.`;
      }
    }

    if(weeklyFlowStep===5){
      const gaps=requiredScheduleGaps();
      if(gaps.length){
        $('weeklyFlowText').textContent=`Review the schedule before output. There ${gaps.length===1?'is':'are'} still ${gaps.length} required uncovered shift${gaps.length===1?'':'s'}. Add or assign shifts as needed. Tap Next only when you are ready to continue.`;
      }else{
        $('weeklyFlowText').textContent='All required shifts are covered. Review hours and assignments, add any extra dishwasher, runner, or server shifts needed, then tap Next.';
      }
    }

    setTimeout(()=>{
      bar.scrollIntoView({behavior:'smooth',block:'start'});
      setTimeout(()=>target?.scrollIntoView({behavior:'smooth',block:'center'}),180);
    },20);
  }

  function wirePrintAndShare(){
    const oldPrint=$('printBtn');
    if(oldPrint){
      const btn=oldPrint.cloneNode(true);
      oldPrint.replaceWith(btn);
      btn.textContent='Share Printable';
      btn.addEventListener('click',sharePrintableSchedule);
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

  function buildPrintableSchedulePayload(){
    const shifts=getWeekShifts();
    return {
      version:1,
      restaurant:'El Mexican Restaurant',
      weekStart:currentSchedule.weekStart,
      days:DAYS.map((day,idx)=>({
        label:DAY_LABEL[day],
        dateLabel:fmtDate(addDays(currentSchedule.weekStart,idx),{month:'numeric',day:'numeric'})
      })),
      rows:state.employees.filter(e=>e.active).map(emp=>({
        name:emp.name,
        cells:DAYS.map((day,idx)=>{
          const date=addDays(currentSchedule.weekStart,idx);
          return shifts
            .filter(s=>s.employee===emp.name && s.date===date)
            .map(shiftText);
        })
      }))
    };
  }

  function encodePrintablePayload(payload){
    const bytes=new TextEncoder().encode(JSON.stringify(payload));
    let binary='';
    bytes.forEach(b=>binary+=String.fromCharCode(b));
    return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }

  async function sharePrintableSchedule(){
    if(!currentSchedule){ showToast('Generate a schedule first'); return; }
    const payload=buildPrintableSchedulePayload();
    const encoded=encodePrintablePayload(payload);
    const base=new URL('print.html',window.location.href);
    const url=`${base.origin}${base.pathname}#schedule=${encoded}`;
    const title=`El Mexican weekly schedule - ${currentSchedule.weekStart}`;
    const text=`Weekly schedule for the week of ${fmtDate(currentSchedule.weekStart,{month:'long',day:'numeric',year:'numeric'})}. Open this link on the work computer and choose Print Schedule.\n\n${url}`;
    try{
      if(navigator.share){
        await navigator.share({title,text,url});
      }else{
        await navigator.clipboard.writeText(text);
        showToast('Printable schedule link copied');
      }
    }catch(err){
      if(err?.name!=='AbortError'){
        try{
          await navigator.clipboard.writeText(text);
          showToast('Printable schedule link copied');
        }catch(_){
          prompt('Copy this printable schedule link:',url);
        }
      }
    }
  }

  function pdfAscii(value){
    return String(value??'')
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[–—]/g,'-')
      .replace(/[“”]/g,'"')
      .replace(/[‘’]/g,"'")
      .replace(/[^\x20-\x7E]/g,'?');
  }

  function pdfEscape(value){
    return pdfAscii(value).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  }

  function pdfText(x,y,size,value,bold=false,align='left'){
    const raw=pdfAscii(value);
    const safe=pdfEscape(raw);
    let tx=x;
    const estimated=raw.length*size*.50;
    if(align==='center') tx-=estimated/2;
    if(align==='right') tx-=estimated;
    return `BT /${bold?'F2':'F1'} ${size} Tf 1 0 0 1 ${tx.toFixed(2)} ${y.toFixed(2)} Tm (${safe}) Tj ET\n`;
  }

  function pdfLine(x1,y1,x2,y2,width=.65){
    return `${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S\n`;
  }

  function pdfFillRect(x,y,w,h,gray=.95){
    return `${gray} g ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f 0 g\n`;
  }

  function buildWeeklySchedulePdf(){
    const pageW=792, pageH=612, margin=24;
    const tableW=pageW-margin*2;
    const nameW=108;
    const dayW=(tableW-nameW)/7;
    const headerH=34;
    const rowH=34;
    const topY=532;
    const maxRows=13;
    const shifts=getWeekShifts();
    const employees=state.employees.filter(e=>e.active);
    const chunks=[];
    for(let i=0;i<Math.max(1,employees.length);i+=maxRows){
      chunks.push(employees.slice(i,i+maxRows));
    }
    if(!employees.length) chunks[0]=[];

    const contents=chunks.map((group,pageIndex)=>{
      let out='';
      out+=pdfText(pageW/2,575,18,'Weekly Schedule',true,'center');
      out+=pdfText(pageW/2,558,9,`El Mexican Restaurant - Week of ${fmtDate(currentSchedule.weekStart,{month:'long',day:'numeric',year:'numeric'})}`,false,'center');
      if(chunks.length>1) out+=pdfText(pageW-margin,558,8,`Page ${pageIndex+1} of ${chunks.length}`,false,'right');

      out+=pdfFillRect(margin,topY-headerH,tableW,headerH,.94);
      const bottomY=topY-headerH-group.length*rowH;
      const xs=[margin,margin+nameW];
      for(let d=1;d<=7;d++) xs.push(margin+nameW+dayW*d);
      xs.forEach(x=>{ out+=pdfLine(x,topY,x,bottomY); });
      out+=pdfLine(margin,topY,margin+tableW,topY);
      out+=pdfLine(margin,topY-headerH,margin+tableW,topY-headerH);
      for(let r=1;r<=group.length;r++){
        const y=topY-headerH-r*rowH;
        out+=pdfLine(margin,y,margin+tableW,y);
      }

      out+=pdfText(margin+7,topY-21,9,'Name',true);
      DAYS.forEach((day,idx)=>{
        const date=addDays(currentSchedule.weekStart,idx);
        const cx=margin+nameW+dayW*idx+dayW/2;
        out+=pdfText(cx,topY-15,8,DAY_LABEL[day],true,'center');
        out+=pdfText(cx,topY-27,7,fmtDate(date,{month:'numeric',day:'numeric'}),false,'center');
      });

      group.forEach((emp,rowIndex)=>{
        const yTop=topY-headerH-rowIndex*rowH;
        out+=pdfText(margin+6,yTop-21,8.5,emp.name,true);
        DAYS.forEach((day,idx)=>{
          const date=addDays(currentSchedule.weekStart,idx);
          const list=shifts.filter(s=>s.employee===emp.name && s.date===date);
          const cx=margin+nameW+dayW*idx+dayW/2;
          if(list.length===1){
            out+=pdfText(cx,yTop-21,7.2,shiftText(list[0]),false,'center');
          }else if(list.length>1){
            list.slice(0,2).forEach((s,lineIndex)=>{
              out+=pdfText(cx,yTop-14-lineIndex*11,6.6,shiftText(s),false,'center');
            });
          }
        });
      });
      out+=pdfText(margin,30,7,'Times shown are scheduled work hours.',false);
      return out;
    });

    const enc=new TextEncoder();
    const objects=[];
    objects[1]='<< /Type /Catalog /Pages 2 0 R >>';
    objects[3]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    objects[4]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
    const pageRefs=[];
    contents.forEach((content,i)=>{
      const pageObj=5+i*2;
      const contentObj=pageObj+1;
      pageRefs.push(`${pageObj} 0 R`);
      objects[pageObj]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj} 0 R >>`;
      objects[contentObj]=`<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`;
    });
    objects[2]=`<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${contents.length} >>`;

    let pdf='%PDF-1.4\n% Schedule App PDF\n';
    const offsets=[0];
    for(let i=1;i<objects.length;i++){
      offsets[i]=enc.encode(pdf).length;
      pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xref=enc.encode(pdf).length;
    pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for(let i=1;i<objects.length;i++){
      pdf+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
    }
    pdf+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new Blob([enc.encode(pdf)],{type:'application/pdf'});
  }

  function downloadPdf(blob,filename){
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
  }

  async function exportWeeklySchedulePdf(){
    if(!currentSchedule){ showToast('Generate a schedule first'); return; }
    const blob=buildWeeklySchedulePdf();
    const filename=`El_Mexican_Schedule_${currentSchedule.weekStart}.pdf`;
    let file=null;
    try{ file=new File([blob],filename,{type:'application/pdf'}); }catch(_){}

    try{
      if(file && navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))){
        await navigator.share({
          title:`El Mexican weekly schedule - ${currentSchedule.weekStart}`,
          text:'Weekly schedule PDF attached. Send this to the restaurant work email for printing.',
          files:[file]
        });
        return;
      }
    }catch(err){
      if(err?.name==='AbortError') return;
    }

    downloadPdf(blob,filename);
    showToast('PDF saved. Attach it to an email from your device.');
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
      const events=calendarEventsForDate(date);
      const cover=(state.specialDateOverrides||[]).filter(x=>x.date===date);
      const cell=document.createElement('button'); cell.type='button'; cell.className='calendar-cell';
      cell.innerHTML=`<span class="calendar-number">${d}</span>`;
      if(events.length){
        const dots=document.createElement('div'); dots.className='calendar-events';
        events.slice(0,2).forEach(ev=>{
          const tag=document.createElement('span'); tag.className=`calendar-tag impact-${ev.staffingImpact||'unknown'} event-${ev.category||'other'}`; tag.textContent=ev.label; dots.appendChild(tag);
        });
        if(events.length>2){ const more=document.createElement('span'); more.className='calendar-more'; more.textContent=`+${events.length-2} more`; dots.appendChild(more); }
        cell.appendChild(dots);
      }else if(cover.length){
        const dots=document.createElement('div'); dots.className='calendar-events';
        const tag=document.createElement('span'); tag.className='calendar-tag coverage'; tag.textContent='Extra coverage'; dots.appendChild(tag); cell.appendChild(dots);
      }
      cell.addEventListener('click',()=>{
        const editable=events.filter(ev=>!ev.system);
        if(editable.length===1) openSpecialDayDialog(editable[0].id);
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
    $('specialDayCategory').value=ev?.category||'local_event';
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
      category:$('specialDayCategory').value,
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
    const y=Number(today.slice(0,4));
    const end=isoYmd(y+1,11,31);
    const list=calendarEventsBetween(today,end).slice(0,24);
    if(!list.length){ root.innerHTML='<p>No upcoming calendar events yet.</p>'; return; }
    root.innerHTML='';
    list.forEach(ev=>{
      const row=document.createElement('div'); row.className='special-day-row';
      row.innerHTML=`<div><strong>${escapeHtml(ev.label)}</strong><div class="list-row-sub">${fmtDate(ev.date,{weekday:'short',month:'short',day:'numeric'})} · ${categoryLabel(ev.category)} · ${impactLabel(ev.staffingImpact)}${ev.reviewStaffing?' · Staffing review reminder':''}</div>${ev.note?`<div class="special-note">${escapeHtml(ev.note)}</div>`:''}</div>`;
      const actions=document.createElement('div'); actions.className='special-actions';
      const cover=document.createElement('button'); cover.type='button'; cover.textContent='Add Coverage';
      cover.addEventListener('click',()=>prefillCoverage(ev));
      actions.appendChild(cover);
      if(!ev.system){
        const edit=document.createElement('button'); edit.type='button'; edit.textContent='Edit'; edit.addEventListener('click',()=>openSpecialDayDialog(ev.id));
        actions.appendChild(edit);
      }
      row.appendChild(actions); root.appendChild(row);
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
    const events=calendarEventsBetween(start,end);
    events.forEach(ev=>{
      const hasCoverage=(state.specialDateOverrides||[]).some(x=>x.date===ev.date);
      const div=document.createElement('div');
      const needsExtra=ev.staffingImpact==='extra_help';
      div.className=`alert ${ev.reviewStaffing?'warn':'ok'}`;
      let status=`${impactLabel(ev.staffingImpact)}.`;
      if(ev.reviewStaffing) status += ' Reminder: review staffing for this day.';
      if(hasCoverage) status += ' Extra coverage has already been added.';
      div.innerHTML=`<strong>${escapeHtml(ev.label)}</strong> <span class="event-kind">(${escapeHtml(categoryLabel(ev.category))})</span> — ${fmtDate(ev.date,{weekday:'long',month:'short',day:'numeric'})}. ${escapeHtml(status)}`;
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
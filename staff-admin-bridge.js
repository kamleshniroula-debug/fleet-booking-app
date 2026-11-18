/* Imports authenticated staff operations before the workbook is serialized.
   Only acknowledgments verified against the saved Supabase snapshot clear operations. */
(()=>{
 let client=null,ids=[],chargingIds=[],chargingSaveIds=[],expenseIds=[],expenseSaveIds=[],pulling=null,paused=false,lease=null,roleGeneration=0;
 const equal=(a,b)=>JSON.stringify(Object.entries(a||{}).filter(([,v])=>v!==''&&v!=null).map(([k,v])=>[k,String(v)]).sort(([a],[b])=>a.localeCompare(b)))===JSON.stringify(Object.entries(b||{}).filter(([,v])=>v!==''&&v!=null).map(([k,v])=>[k,String(v)]).sort(([a],[b])=>a.localeCompare(b)));
 const label=(text,bad=false)=>{let el=document.getElementById('pvrStaffSync');if(!el){el=document.createElement('div');el.id='pvrStaffSync';el.className='hint';el.style.padding='10px';document.getElementById('dualSyncState')?.parentNode.appendChild(el)}el.textContent='Staff: '+text;el.style.color=bad?'#b2454d':'#147b58'};
 async function pull(){
  if(pulling)return pulling;
  if(!client||!cloudLoaded||!token||!zip||source!=='OneDrive '+cloudFile)return;
  if(paused)throw Error('Staff synchronization paused after a conflict. Reload the cloud workbook and retry.');
  pulling=(async()=>{
   const {data:session,error:authError}=await client.auth.getSession();if(authError||!session.session)throw Error('Sign in as administrator before saving staff-enabled workbooks.');
   const {data:operations,error}=await client.rpc('pvr_staff_admin_pending');
   if(error){if(error.code==='PGRST202'||error.code==='42883'){label('setup not installed; use enable-staff-access.sql');return}throw Error('Staff sync: '+error.message)}
   const groups=new Map();for(const op of operations){const g=groups.get(op.booking_id)||{before:op.before_row,after:op.after_row,ids:[]};g.after=op.after_row;g.ids.push(op.operation_id);groups.set(op.booking_id,g)}
   const changes=[];
   for(const [id,g] of groups){const matches=rows('Bookings').map((r,i)=>({r,i})).filter(x=>x.r['Booking ID']===id);if(matches.length>1)throw Error('Duplicate booking ID '+id+' needs administrator repair before staff synchronization.');const current=matches[0]?.r,index=matches[0]?.i??-1;
    if(equal(current,g.after))continue;
    if(!equal(current,g.before)){
     const summary=r=>r?JSON.stringify(Object.fromEntries(['Customer Name','Vehicle ID','Start AD','End AD Exclusive','Advance NPR','Status'].map(k=>[k,r[k]||'']))):'(no booking)';
     if(!confirm('STAFF BOOKING CONFLICT: '+id+'\n\nYour local version:\n'+summary(current)+'\n\nStaff version:\n'+summary(g.after)+'\n\nUse the staff version? Cancel pauses saving so you can preserve your local workbook and review.')){paused=true;throw Error('Staff conflict needs review for '+id+'. Download a local backup, then reload the cloud workbook.');}
    }
    changes.push({index,row:g.after});
   }
   const [charging,expenses]=await Promise.all([
    client.rpc('pvr_staff_admin_charging_pending'),
    client.rpc('pvr_staff_admin_expenses_pending')
   ]);
   for(const [name,result] of [['Charging bill',charging],['Staff expense',expenses]]){
    if(result.error&&!['PGRST202','42883'].includes(result.error.code))throw Error(name+' sync: '+result.error.message);
   }
   for(const {index,row} of changes){for(const k of Object.keys(row))if(!SCHEMAS.Bookings.includes(k))SCHEMAS.Bookings.push(k);if(index<0)rows('Bookings').push({...row});else rows('Bookings')[index]={...row}}
   const bills=charging.data||[];
   let importedBills=0;
   for(const bill of bills||[]){
    const id='STF-CHG-'+bill.id;
    const current=rows('Electricity Bills').find(row=>row['Bill ID']===id);
    if(current)continue;
    rows('Electricity Bills').push({'Bill ID':id,'Vehicle ID':bill.vehicle_id,'Bill AD':bill.bill_date,'Total NPR':String(bill.total_npr),'Payment Status':'','Notes':''});
    importedBills++;
   }
   let importedExpenses=0;
   for(const expense of expenses.data||[]){
    const id='STF-EXP-'+expense.id;
    if(rows('Other Expenses').some(row=>row['Expense ID']===id))continue;
    rows('Other Expenses').push({
     'Expense ID':id,'Date AD':expense.bill_date,'Category':expense.kind==='washing'?'Washing':'Extra Expense',
     'Vehicle ID':expense.vehicle_id,'Amount NPR':String(expense.total_npr),'Paid By':'','Notes':expense.note
    });
    importedExpenses++;
   }
   chargingIds=bills.map(bill=>bill.id);
   expenseIds=(expenses.data||[]).map(expense=>expense.id);
   ids=operations.map(o=>o.operation_id);
   if(changes.length||importedBills||importedExpenses){dirty=true;editVersion++;render();label(changes.length+' booking(s), '+importedBills+' charging bill(s), '+importedExpenses+' other expense(s) imported; Excel save pending')}
   else label(ids.length?ids.length+' operation(s) awaiting save verification':'up to date');
  })();try{return await pulling}finally{pulling=null}
 }
 function validateMergedBookings(){
  const open=rows('Bookings').filter(r=>!['Cancelled','Returned','Completed'].includes(r.Status)&&r['Start AD']&&r['End AD Exclusive']);
  const staffIds=new Set(rows('Bookings').filter(r=>r['Staff Revision']).map(r=>r['Booking ID']));
  for(let i=0;i<open.length;i++)for(let j=i+1;j<open.length;j++){
   const a=open[i],b=open[j];if(!(staffIds.has(a['Booking ID'])||staffIds.has(b['Booking ID'])))continue;
   if(a['Vehicle ID']===b['Vehicle ID']&&a['Start AD']<b['End AD Exclusive']&&b['Start AD']<a['End AD Exclusive'])throw Error('Booking overlap involving staff records: '+a['Booking ID']+' / '+b['Booking ID']+'. Correct the dates before saving.');
  }
 }
 function gate(allowed,text){document.body.classList.toggle('pvr-admin-locked',!allowed);const el=document.getElementById('pvrAdminGate');if(el)el.hidden=allowed;const msg=document.getElementById('pvrAdminGateMessage');if(msg)msg.textContent=text;}
 async function requireAdmin(){
  if(!client)throw Error('Administrator sign-in is not ready yet.');
  const {data,error}=await client.auth.getSession();
  if(error||!data.session){gate(false,'Use your administrator passkey to open the dashboard.');throw Error('Administrator sign-in required.');}
  const result=await client.rpc('pvr_staff_admin_pending');
  if(result.error){const text=result.error.code==='PGRST202'||result.error.code==='42883'?'Install enable-staff-access.sql in Supabase first, then sign in as administrator.':'Administrator access is required. Staff should use the staff workspace.';gate(false,text);throw Error(text)}
  const current=await client.auth.getSession();if(current.data.session?.user?.id!==data.session.user.id){gate(false,'Account changed. Sign in as administrator.');throw Error('Account changed during verification.')}
  const email=current.data.session.user.email;
  if(email){try{localStorage.setItem('pvr_verified_admin_email',email)}catch{}}
  gate(true,'Administrator verified');return true;
 }
 window.pvrStaffBridge={
  requireAdmin,
  async sessionChanged(session){let staffDestination=false;try{staffDestination=sessionStorage.getItem('pvr_oauth_destination')==='staff'}catch{}if(session&&staffDestination){try{sessionStorage.removeItem('pvr_oauth_destination')}catch{}window.location.replace(new URL('staff.html',window.location.href).href);return}const signIn=document.getElementById('pvrAdminSignIn');if(signIn)signIn.textContent=session?'Change Google account':'Continue with Google';const generation=++roleGeneration;if(!session){gate(false,'Use your administrator passkey to open the dashboard.');return}try{await requireAdmin()}catch(e){if(generation===roleGeneration)label(e.message,true)}},
  connect(c){if(client===c)return;client=c;window.dispatchEvent(new Event('pvr-staff-ready'));const button=document.createElement('a');button.href='staff.html';button.className='btn';button.textContent='Staff access & booking portal';button.style.display='inline-block';button.style.margin='8px';document.getElementById('googleLogin')?.parentNode.appendChild(button);label('checking setup…')},
  async beforeSave(){
   chargingSaveIds=[];expenseSaveIds=[];
   if(!client)return;
   const next=crypto.randomUUID();const {error}=await client.rpc('pvr_staff_sync_lease',{p_token:next,p_release:false});
   if(error){if(error.code==='PGRST202'||error.code==='42883')return;throw Error(error.message)}
   lease=next;
   try{await pull();validateMergedBookings();chargingSaveIds=[...chargingIds];expenseSaveIds=[...expenseIds]}catch(e){await this.endSave();throw e}
  },
  async endSave(){if(!lease||!client)return;const current=lease;lease=null;const {error}=await client.rpc('pvr_staff_sync_lease',{p_token:current,p_release:true});if(error)label('save lease will expire automatically: '+error.message,true)},
  async afterSnapshot(){
   if(!client)return;
   if(chargingSaveIds.length){
    const {error}=await client.rpc('pvr_staff_admin_charging_ack',{p_ids:chargingSaveIds});
    if(error)label('workbook saved; charging bill acknowledgment pending: '+error.message,true);
    chargingSaveIds=[];
   }
   if(expenseSaveIds.length){
    const {error}=await client.rpc('pvr_staff_admin_expenses_ack',{p_ids:expenseSaveIds});
    if(error)label('workbook saved; staff expense acknowledgment pending: '+error.message,true);
    expenseSaveIds=[];
   }
   if(!ids.length)return;const batch=[...ids];const {error}=await client.rpc('pvr_staff_admin_ack',{p_ids:batch});if(error){label('workbook saved; acknowledgment pending: '+error.message,true);return}ids=ids.filter(id=>!batch.includes(id));label('changes saved to Excel and verified')},
  async tick(){if(!client||!cloudLoaded||!token||!zip||autoSaving||document.hidden)return;try{await pull();if(dirty)await autoSaveCloud()}catch(e){label(e.message,true)}}
 };
 setInterval(()=>window.pvrStaffBridge.tick(),20000);
 window.addEventListener('pvr-cloud-loaded',()=>{paused=false;ids=[];chargingIds=[];chargingSaveIds=[];expenseIds=[];expenseSaveIds=[];setTimeout(()=>window.pvrStaffBridge.tick(),3000)});
})();

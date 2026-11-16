// Supabase Edge Function: partner-email-access
// Deploy with JWT verification enabled; service-role key stays server-side.
import { createClient } from 'npm:@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'https://kamleshniroula-debug.github.io','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 try{
  const url=Deno.env.get('SUPABASE_URL')!,secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin=createClient(url,secret,{auth:{persistSession:false}});
  const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  if(!token)return json({error:'Authentication required'},401);
  const {data:{user},error:authError}=await admin.auth.getUser(token);
  if(authError||!user)return json({error:'Invalid login'},401);
  const body=await req.json();
  if(body.action==='assign'){
   const {data:member}=await admin.from('pvr_members').select('role,active').eq('user_id',user.id).maybeSingle();
   if(member?.role!=='admin'||member?.active!==true)return json({error:'Active administrator required'},403);
   const email=String(body.email||'').trim().toLowerCase();
   const company_id=String(body.company_id||'');
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return json({error:'Invalid email'},400);
   if(!/^[0-9a-f-]{36}$/i.test(company_id))return json({error:'Invalid company ID'},400);
   const {data:company,error:ce}=await admin.from('pvr_rental_companies').select('company_id').eq('company_id',company_id).eq('active',true).maybeSingle();
   if(ce||!company)return json({error:'Company must be active'},400);
   // Never enumerate auth.users to the browser; store a pending invitation instead.
   const {error}=await admin.from('pvr_partner_email_invites').upsert({email,company_id,assigned_by:user.id},{onConflict:'email'});
   if(error)throw error;
   return json({ok:true,assigned:false});
  }
  if(body.action==='claim'){
   // Require a Google OAuth identity, not an unverified email/password account.
   const google=(user.identities||[]).some((i:any)=>i.provider==='google');
   if(!google||!user.email)return json({error:'Google sign-in required'},403);
   const email=user.email.toLowerCase();
   const {data:invite,error:ie}=await admin.from('pvr_partner_email_invites').select('company_id').eq('email',email).maybeSingle();
   if(ie)throw ie;
   if(!invite)return json({ok:true,assigned:false});
   const {data:company}=await admin.from('pvr_rental_companies').select('active').eq('company_id',invite.company_id).maybeSingle();
   if(!company?.active)return json({error:'Company inactive'},403);
   const {data:member}=await admin.from('pvr_members').select('role,active').eq('user_id',user.id).maybeSingle();
   if(member?.role==='admin'&&member?.active)return json({error:'Administrator cannot be reassigned'},403);
   const {error}=await admin.from('pvr_partner_members').upsert({user_id:user.id,company_id:invite.company_id,active:true},{onConflict:'user_id'});
   if(error)throw error;
   return json({ok:true,assigned:true});
  }
  return json({error:'Unknown action'},400);
 }catch(e){console.error(e);return json({error:'Unable to complete assignment'},500)}
});


begin;

-- Extend the existing operation log without rewriting historical rows.
alter table public.pvr_staff_operations
  drop constraint pvr_staff_operations_action_check,
  add constraint pvr_staff_operations_action_check
    check (action in ('create','edit','payment','handover','return','complete','cancel','extend'));

-- Preserve the installed RPC's role checks, synchronization, and validation.
-- Abort if any expected fragment differs from the version reviewed.
do $migration$
declare
  definition text := pg_get_functiondef(
    'public.pvr_staff_submit(uuid,text,text,text,jsonb)'::regprocedure
  );
  patch record;
begin
  for patch in
    select * from (values
      ($old$if not pvr_staff_private.is_admin() and p_action='edit' then raise exception 'Existing bookings can only be edited by the administrator.' using errcode='42501'; end if;$old$,
       ''),
      ($old$p_action not in ('create','edit','payment','handover','return','complete')$old$,
       $new$p_action not in ('create','edit','payment','handover','return','complete','cancel','extend')$new$),
      ($old$(p_action in ('handover','return','complete') and p_values<>'{}'::jsonb)$old$,
       $new$(p_action in ('handover','return','complete','cancel') and p_values<>'{}'::jsonb)
       or (p_action='extend' and exists(select 1 from jsonb_object_keys(p_values) t(key)
           where key not in ('End AD Exclusive','warning_confirmed')))$new$),
      ($old$check_dates:=p_action in ('create','edit','handover');$old$,
       $new$
       if p_action='cancel' then
         if nullif(b->>'Handover AD','') is not null then
           raise exception 'A booking cannot be cancelled after vehicle handover.';
         end if;
         r:=r||jsonb_build_object('Status','Cancelled');
       end if;
       if p_action='extend' then
         if jsonb_typeof(p_values->'End AD Exclusive') is distinct from 'string'
            or not coalesce((p_values->>'End AD Exclusive') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',false)
            or nullif(b->>'End AD Exclusive','') is null
            or (p_values->>'End AD Exclusive')::date <= (b->>'End AD Exclusive')::date then
           raise exception 'Select a new last rental date after the current one.';
         end if;
         r:=jsonb_set(r,array['End AD Exclusive'],p_values->'End AD Exclusive');
         details:=jsonb_build_object('previous_end',b->>'End AD Exclusive',
                                     'new_end',r->>'End AD Exclusive');
       end if;
       check_dates:=p_action in ('create','edit','handover','extend');$new$),
      ($old$if p_action in ('create','edit') and flag->>'status'='Warning'$old$,
       $new$if p_action in ('create','edit','extend') and flag->>'status'='Warning'$new$)
    ) as replacements(before_text, after_text)
  loop
    if (length(definition)-length(replace(definition,patch.before_text,''))) <> length(patch.before_text) then
      raise exception 'Unexpected staff booking function version. Migration stopped.';
    end if;
    definition := replace(definition,patch.before_text,patch.after_text);
  end loop;

  execute definition;
end;
$migration$;

commit;

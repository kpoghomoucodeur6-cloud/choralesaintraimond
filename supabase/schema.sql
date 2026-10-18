-- Chora : schéma Supabase (profils, rôles, chants, favoris, stockage).
-- À exécuter une fois dans Supabase > SQL Editor. Peut être relancé sans danger.

-- ---------- Profils et rôles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  voice_part text check (voice_part in ('soprano', 'alto', 'tenor', 'bass', 'solo')),
  role text not null default 'choriste' check (role in ('admin', 'choriste')),
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists voice_part text;

alter table public.profiles
  drop constraint if exists profiles_voice_part_check;
alter table public.profiles
  add constraint profiles_voice_part_check check (voice_part is null or voice_part in ('soprano', 'alto', 'tenor', 'bass', 'solo'));

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Le premier administrateur n'est promu qu'une fois son e-mail confirmé.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, voice_part, role)
  values (
    new.id,
    new.email,
    coalesce(left(new.raw_user_meta_data ->> 'full_name', 100), ''),
    case
      when new.raw_user_meta_data ->> 'voice_part' in ('soprano', 'alto', 'tenor', 'bass', 'solo')
        then new.raw_user_meta_data ->> 'voice_part'
      else null
    end,
    case
      when lower(new.email) = 'johnkpoghomou@gmail.com' and new.email_confirmed_at is not null
        then 'admin'
      else 'choriste'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.promote_first_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_confirmed_at is not null
     and old.email_confirmed_at is null
     and lower(new.email) = 'johnkpoghomou@gmail.com' then
    update public.profiles set role = 'admin' where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute function public.promote_first_admin();

-- Rattrape les comptes éventuellement créés avant ce script.
insert into public.profiles (id, email, role)
select id, email,
       case when lower(email) = 'johnkpoghomou@gmail.com' and email_confirmed_at is not null
            then 'admin' else 'choriste' end
from auth.users
on conflict (id) do nothing;

update public.profiles as profile
set voice_part = auth_user.raw_user_meta_data ->> 'voice_part'
from auth.users as auth_user
where profile.id = auth_user.id
  and profile.voice_part is null
  and auth_user.raw_user_meta_data ->> 'voice_part' in ('soprano', 'alto', 'tenor', 'bass', 'solo');

alter table public.profiles enable row level security;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (role) on public.profiles to authenticated;

-- ---------- Chants ----------
create table if not exists public.songs (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 140),
  category text not null check (category in (
    'Chant d''entrée', 'Kyrie', 'Gloria', 'Psaume', 'Alléluia', 'Offertoire',
    'Sanctus', 'Agnus Dei', 'Communion', 'Chant de sortie', 'Chants mariaux', 'Autres chants'
  )),
  author text not null default '' check (char_length(author) <= 120),
  duration text not null default '' check (char_length(duration) <= 20),
  lyrics text not null default '' check (char_length(lyrics) <= 30000),
  pdf_path text,
  pdf_name text,
  audio_path text,
  audio_name text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.songs
  add column if not exists soprano_audio_path text,
  add column if not exists soprano_audio_name text,
  add column if not exists alto_audio_path text,
  add column if not exists alto_audio_name text,
  add column if not exists tenor_audio_path text,
  add column if not exists tenor_audio_name text,
  add column if not exists bass_audio_path text,
  add column if not exists bass_audio_name text;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists songs_touch_updated_at on public.songs;
create trigger songs_touch_updated_at
  before update on public.songs
  for each row execute function public.touch_updated_at();

alter table public.songs enable row level security;

drop policy if exists "songs_select" on public.songs;
create policy "songs_select" on public.songs
  for select to authenticated using (true);

drop policy if exists "songs_insert_admin" on public.songs;
create policy "songs_insert_admin" on public.songs
  for insert to authenticated with check (public.is_admin());

drop policy if exists "songs_update_admin" on public.songs;
create policy "songs_update_admin" on public.songs
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "songs_delete_admin" on public.songs;
create policy "songs_delete_admin" on public.songs
  for delete to authenticated using (public.is_admin());

revoke all on public.songs from anon, authenticated;
grant select, insert, update, delete on public.songs to authenticated;

-- ---------- Classement par temps, fêtes et célébrations ----------
create table if not exists public.song_categories (
  song_id uuid not null references public.songs (id) on delete cascade,
  category text not null check (category in (
    'Noël et Épiphanie', 'Temps ordinaire', 'Avent', 'Carême', 'Semaine sainte',
    'Pâques et temps pascal', 'Ascension', 'Pentecôte', 'Assomption', 'Toussaint',
    'Chants pour les défunts', 'Chants mariaux', 'Baptême', 'Première communion',
    'Confirmation', 'Mariage', 'Fêtes patronales et paroissiales',
    'Adoration eucharistique', 'Action de grâce', 'Autres célébrations'
  )),
  primary key (song_id, category)
);

insert into public.song_categories (song_id, category)
select id, category
from public.songs
where category in ('Chants mariaux')
on conflict (song_id, category) do nothing;

alter table public.song_categories enable row level security;

drop policy if exists "song_categories_select" on public.song_categories;
create policy "song_categories_select" on public.song_categories
  for select to authenticated using (true);

revoke all on public.song_categories from anon, authenticated;
grant select on public.song_categories to authenticated;

create or replace function public.set_song_categories(p_song_id uuid, p_categories text[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'admin role required';
  end if;
  if p_categories is null or cardinality(p_categories) > 20 then
    raise exception 'invalid category list';
  end if;
  if cardinality(p_categories) <> (
    select count(distinct category) from unnest(p_categories) as requested(category)
  ) then
    raise exception 'duplicate category';
  end if;

  delete from public.song_categories where song_id = p_song_id;
  insert into public.song_categories (song_id, category)
  select p_song_id, requested.category
  from unnest(p_categories) as requested(category);
end;
$$;

revoke all on function public.set_song_categories(uuid, text[]) from public, anon;
grant execute on function public.set_song_categories(uuid, text[]) to authenticated;

-- ---------- Programmes des messes ----------
create table if not exists public.mass_programs (
  id uuid primary key,
  celebration_name text not null check (char_length(btrim(celebration_name)) between 1 and 160),
  mass_type text not null check (mass_type in (
    'sunday', 'christmas', 'easter', 'wedding', 'baptism', 'funeral', 'patronal', 'other'
  )),
  celebration_at timestamptz not null,
  parish_name text not null check (char_length(btrim(parish_name)) between 1 and 160),
  celebrant_name text not null default '' check (char_length(celebrant_name) <= 160),
  choir_name text not null check (char_length(btrim(choir_name)) between 1 and 160),
  general_notes text not null default '' check (char_length(general_notes) <= 3000),
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mass_program_steps (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.mass_programs (id) on delete cascade,
  stage_key text not null constraint mass_program_steps_stage_key_check check (stage_key in (
    'entrance', 'kyrie', 'gloria', 'psalm', 'gospel_acclamation', 'gospel_homily',
    'creed', 'intercessions', 'offertory', 'sanctus', 'consecration_acclamation',
    'our_father', 'sign_of_peace', 'agnus_dei', 'communion', 'thanksgiving', 'exit'
  )),
  position integer not null constraint mass_program_steps_position_check check (position between 1 and 17),
  is_visible boolean not null default true,
  song_id uuid references public.songs (id) on delete set null,
  note text not null default '' check (char_length(note) <= 1000),
  unique (program_id, stage_key),
  unique (program_id, position)
);

alter table public.mass_program_steps drop constraint if exists mass_program_steps_stage_key_check;
alter table public.mass_program_steps
  add constraint mass_program_steps_stage_key_check check (stage_key in (
    'entrance', 'kyrie', 'gloria', 'psalm', 'gospel_acclamation', 'gospel_homily',
    'creed', 'intercessions', 'offertory', 'sanctus', 'consecration_acclamation',
    'our_father', 'sign_of_peace', 'agnus_dei', 'communion', 'thanksgiving', 'exit'
  ));

alter table public.mass_program_steps drop constraint if exists mass_program_steps_position_check;
update public.mass_program_steps set position = position + 100;
update public.mass_program_steps
set position = case stage_key
  when 'entrance' then 1
  when 'kyrie' then 2
  when 'gloria' then 3
  when 'psalm' then 4
  when 'gospel_acclamation' then 5
  when 'gospel_homily' then 6
  when 'creed' then 7
  when 'intercessions' then 8
  when 'offertory' then 9
  when 'sanctus' then 10
  when 'consecration_acclamation' then 11
  when 'our_father' then 12
  when 'sign_of_peace' then 13
  when 'agnus_dei' then 14
  when 'communion' then 15
  when 'thanksgiving' then 16
  when 'exit' then 17
end;
insert into public.mass_program_steps (program_id, stage_key, position, is_visible)
select programs.id, stages.stage_key, stages.position, true
from public.mass_programs programs
cross join (values
  ('gospel_homily', 6),
  ('creed', 7),
  ('our_father', 12),
  ('sign_of_peace', 13)
) as stages(stage_key, position)
on conflict (program_id, stage_key) do nothing;
alter table public.mass_program_steps
  add constraint mass_program_steps_position_check check (position between 1 and 17);

create table if not exists public.mass_program_step_songs (
  step_id uuid not null references public.mass_program_steps (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  position integer not null check (position between 1 and 3),
  primary key (step_id, position),
  unique (step_id, song_id)
);

insert into public.mass_program_step_songs (step_id, song_id, position)
select id, song_id, 1
from public.mass_program_steps
where song_id is not null
on conflict do nothing;

alter table public.mass_program_step_songs enable row level security;

drop trigger if exists mass_programs_touch_updated_at on public.mass_programs;
create trigger mass_programs_touch_updated_at
  before update on public.mass_programs
  for each row execute function public.touch_updated_at();

alter table public.mass_programs enable row level security;
alter table public.mass_program_steps enable row level security;

drop policy if exists "mass_programs_select" on public.mass_programs;
create policy "mass_programs_select" on public.mass_programs
  for select to authenticated using (true);

drop policy if exists "mass_programs_delete_admin" on public.mass_programs;
create policy "mass_programs_delete_admin" on public.mass_programs
  for delete to authenticated using (public.is_admin());

drop policy if exists "mass_program_steps_select" on public.mass_program_steps;
create policy "mass_program_steps_select" on public.mass_program_steps
  for select to authenticated using (true);

drop policy if exists "mass_program_step_songs_select" on public.mass_program_step_songs;
create policy "mass_program_step_songs_select" on public.mass_program_step_songs
  for select to authenticated using (true);

revoke all on public.mass_programs, public.mass_program_steps, public.mass_program_step_songs from anon, authenticated;
grant select, delete on public.mass_programs to authenticated;
grant select on public.mass_program_steps, public.mass_program_step_songs to authenticated;

create or replace function public.save_mass_program(
  p_id uuid,
  p_celebration_name text,
  p_mass_type text,
  p_celebration_at timestamptz,
  p_parish_name text,
  p_celebrant_name text,
  p_choir_name text,
  p_general_notes text,
  p_steps jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Action réservée aux administrateurs.';
  end if;
  if p_steps is null or jsonb_typeof(p_steps) is distinct from 'array' then
    raise exception 'Les étapes du programme sont invalides.';
  end if;
  if p_id is null
     or char_length(btrim(coalesce(p_celebration_name, ''))) not between 1 and 160
     or p_mass_type is null
     or p_mass_type not in ('sunday', 'christmas', 'easter', 'wedding', 'baptism', 'funeral', 'patronal', 'other')
     or p_celebration_at is null
     or char_length(btrim(coalesce(p_parish_name, ''))) not between 1 and 160
     or char_length(coalesce(p_celebrant_name, '')) > 160
     or char_length(btrim(coalesce(p_choir_name, ''))) not between 1 and 160
     or char_length(coalesce(p_general_notes, '')) > 3000
     or jsonb_array_length(p_steps) <> 17 then
    raise exception 'Informations du programme invalides.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_steps) as step(stage_key text, position integer, is_visible boolean, song_ids jsonb, note text)
    where step.stage_key not in (
      'entrance', 'kyrie', 'gloria', 'psalm', 'gospel_acclamation', 'gospel_homily',
      'creed', 'intercessions', 'offertory', 'sanctus', 'consecration_acclamation',
      'our_father', 'sign_of_peace', 'agnus_dei', 'communion', 'thanksgiving', 'exit'
    )
       or step.stage_key is null
       or step.position is null
       or step.position not between 1 and 17
       or step.is_visible is null
       or jsonb_typeof(step.song_ids) is distinct from 'array'
       or case
            when jsonb_typeof(step.song_ids) = 'array' then jsonb_array_length(step.song_ids) > 3
            else false
          end
       or char_length(coalesce(step.note, '')) > 1000
       or exists (
         select 1
         from jsonb_array_elements_text(
           case when jsonb_typeof(step.song_ids) = 'array' then step.song_ids else '[]'::jsonb end
         ) as selected_song(song_id)
         group by selected_song.song_id
         having count(*) > 1
       )
  ) or (
    select count(distinct step.stage_key)
    from jsonb_to_recordset(p_steps) as step(stage_key text, position integer, is_visible boolean, song_ids jsonb, note text)
  ) <> 17 or (
    select count(distinct step.position)
    from jsonb_to_recordset(p_steps) as step(stage_key text, position integer, is_visible boolean, song_ids jsonb, note text)
  ) <> 17 then
    raise exception 'Les étapes du programme sont invalides.';
  end if;

  insert into public.mass_programs (
    id, celebration_name, mass_type, celebration_at, parish_name,
    celebrant_name, choir_name, general_notes, created_by
  ) values (
    p_id, btrim(p_celebration_name), p_mass_type, p_celebration_at, btrim(p_parish_name),
    btrim(coalesce(p_celebrant_name, '')), btrim(p_choir_name), btrim(coalesce(p_general_notes, '')), auth.uid()
  )
  on conflict (id) do update set
    celebration_name = excluded.celebration_name,
    mass_type = excluded.mass_type,
    celebration_at = excluded.celebration_at,
    parish_name = excluded.parish_name,
    celebrant_name = excluded.celebrant_name,
    choir_name = excluded.choir_name,
    general_notes = excluded.general_notes
  returning id into saved_id;

  delete from public.mass_program_steps where program_id = saved_id;
  with inserted_steps as (
    insert into public.mass_program_steps (program_id, stage_key, position, is_visible, song_id, note)
    select saved_id, step.stage_key, step.position, step.is_visible,
      nullif(step.song_ids->>0, '')::uuid, btrim(coalesce(step.note, ''))
    from jsonb_to_recordset(p_steps) as step(stage_key text, position integer, is_visible boolean, song_ids jsonb, note text)
    returning id, stage_key
  )
  insert into public.mass_program_step_songs (step_id, song_id, position)
  select inserted_steps.id, selected_song.song_id::uuid, selected_song.position::integer
  from inserted_steps
  join jsonb_to_recordset(p_steps) as step(stage_key text, song_ids jsonb)
    on step.stage_key = inserted_steps.stage_key
  cross join lateral jsonb_array_elements_text(coalesce(step.song_ids, '[]'::jsonb))
    with ordinality as selected_song(song_id, position);

  return saved_id;
end;
$$;

revoke all on function public.save_mass_program(uuid, text, text, timestamptz, text, text, text, text, jsonb) from public, anon;
grant execute on function public.save_mass_program(uuid, text, text, timestamptz, text, text, text, text, jsonb) to authenticated;

-- ---------- Favoris (privés à chaque membre) ----------
create table if not exists public.favorites (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, song_id)
);

alter table public.favorites enable row level security;

drop policy if exists "favorites_select_own" on public.favorites;
create policy "favorites_select_own" on public.favorites
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "favorites_insert_own" on public.favorites;
create policy "favorites_insert_own" on public.favorites
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "favorites_delete_own" on public.favorites;
create policy "favorites_delete_own" on public.favorites
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.favorites from anon, authenticated;
grant select, insert, delete on public.favorites to authenticated;

-- ---------- Stockage privé des partitions et audios ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chora-files', 'chora-files', false, 5242880, array['application/pdf', 'audio/*'])
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['application/pdf', 'audio/*'];

drop policy if exists "chora_files_select" on storage.objects;
create policy "chora_files_select" on storage.objects
  for select to authenticated using (bucket_id = 'chora-files');

drop policy if exists "chora_files_insert_admin" on storage.objects;
create policy "chora_files_insert_admin" on storage.objects
  for insert to authenticated with check (bucket_id = 'chora-files' and public.is_admin());

drop policy if exists "chora_files_update_admin" on storage.objects;
create policy "chora_files_update_admin" on storage.objects
  for update to authenticated
  using (bucket_id = 'chora-files' and public.is_admin())
  with check (bucket_id = 'chora-files' and public.is_admin());

drop policy if exists "chora_files_delete_admin" on storage.objects;
create policy "chora_files_delete_admin" on storage.objects
  for delete to authenticated using (bucket_id = 'chora-files' and public.is_admin());

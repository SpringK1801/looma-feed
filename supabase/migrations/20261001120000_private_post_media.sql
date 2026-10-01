-- Media bytes live exclusively in Storage. Apply before deploying the new UI.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media', 'post-media', false, 26214400, array['image/webp','video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

alter table public.posts
  add column if not exists media_path text,
  add column if not exists media_type text,
  add column if not exists media_size bigint,
  add column if not exists media_duration double precision;

alter table public.posts add constraint posts_media_valid check (
  (media_path is null and media_type is null and media_size is null and media_duration is null)
  or (
    media_path is not null and media_type is not null and media_size is not null
    and split_part(media_path, '/', 1) = author_id::text
    and media_size > 0
    and (
      (media_type = 'image/webp' and media_size <= 5242880 and media_duration is null)
      or (media_type in ('video/mp4','video/webm','video/quicktime') and media_size <= 26214400
        and media_duration is not null and media_duration > 0 and media_duration <= 10)
    )
  )
);
create index posts_media_path_idx on public.posts(media_path) where media_path is not null;

-- Validate references against the actual uploaded object, not just submitted metadata.
create or replace function public.validate_post_media_reference()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.media_path is not null and not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'post-media' and o.name = new.media_path
      and (o.metadata->>'size')::bigint = new.media_size
      and o.metadata->>'mimetype' = new.media_type
  ) then
    raise exception 'A mídia enviada não corresponde a um ficheiro válido no storage.';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_post_media_reference() from public;
create trigger validate_post_media_reference before insert or update of media_path, media_type, media_size
on public.posts for each row execute function public.validate_post_media_reference();

create policy "Users upload their post media" on storage.objects for insert to authenticated
with check (
  bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text
  and (
    (metadata->>'mimetype' = 'image/webp' and (metadata->>'size')::bigint <= 5242880)
    or (metadata->>'mimetype' in ('video/mp4','video/webm','video/quicktime') and (metadata->>'size')::bigint <= 26214400)
  )
);
create policy "Read visible post media" on storage.objects for select to anon, authenticated
using (bucket_id = 'post-media' and (
  (storage.foldername(name))[1] = auth.uid()::text
  or exists (select 1 from public.posts p where p.media_path = name and p.status = 'published')
));
create policy "Users remove their post media" on storage.objects for delete to authenticated
using (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- New avatars use private paths too; existing external/public URLs remain readable.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-media', 'profile-media', false, 2097152, array['image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy "Users upload private avatars" on storage.objects for insert to authenticated
with check (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Read visible private avatars" on storage.objects for select to anon, authenticated
using (bucket_id = 'profile-media' and (
  (storage.foldername(name))[1] = auth.uid()::text
  or exists (
    select 1 from public.profiles p
    where p.avatar_url = 'storage:profile-media/' || name
      and p.id::text = (storage.foldername(name))[1]
  )
));
create policy "Users delete private avatars" on storage.objects for delete to authenticated
using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);

notify pgrst, 'reload schema';

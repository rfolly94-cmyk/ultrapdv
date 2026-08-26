begin;

-- Logo personalizada do recibo de venda.
-- Não altera empresas.logo_path. Isolada por empresa_id.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'recibos-logos',
  'recibos-logos',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists recibos_logos_select_publico on storage.objects;
drop policy if exists recibos_logos_insert_empresa on storage.objects;
drop policy if exists recibos_logos_update_empresa on storage.objects;
drop policy if exists recibos_logos_delete_empresa on storage.objects;

create policy recibos_logos_select_publico
on storage.objects
for select
to public
using (bucket_id = 'recibos-logos');

create policy recibos_logos_insert_empresa
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'recibos-logos'
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and public.tem_acesso_empresa(((storage.foldername(name))[1])::uuid)
);

create policy recibos_logos_update_empresa
on storage.objects
for update
to authenticated
using (
  bucket_id = 'recibos-logos'
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and public.tem_acesso_empresa(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'recibos-logos'
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and public.tem_acesso_empresa(((storage.foldername(name))[1])::uuid)
);

create policy recibos_logos_delete_empresa
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'recibos-logos'
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and public.tem_acesso_empresa(((storage.foldername(name))[1])::uuid)
);

comment on table public.recibos_layout_config is
  'Configuração visual do recibo de venda da empresa ativa, inclusive path da logo personalizada no bucket recibos-logos. Não altera a logo oficial nem dados comerciais.';

notify pgrst, 'reload schema';

commit;

select version
from supabase_migrations.schema_migrations
where version in (
  '20260813173000',
  '20260813220500'
)
order by version;

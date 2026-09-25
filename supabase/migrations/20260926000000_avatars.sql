-- =====================================================================
-- TaskFlow AI — تصویر پروفایل کاربران
-- اجرای دوباره‌ی این فایل بی‌خطر است (ایدمپوتنت).
--
-- ستون avatar_url نشانی عمومی تصویر هر کاربر را نگه می‌دارد و تصویرها در
-- باکت عمومی «avatars» ذخیره می‌شوند. نوشتن فقط از سمت سرور و با کلید سرویس
-- انجام می‌شود (اکشن‌های اپ)، پس برای کاربران policy نوشتن لازم نیست.
-- =====================================================================

alter table public.profiles add column if not exists avatar_url text;

insert into storage.buckets (id, name)
values ('avatars', 'avatars')
on conflict (id) do nothing;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'public') then
    execute $q$update storage.buckets set public = true where id = 'avatars'$q$;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute $q$update storage.buckets set file_size_limit = 2097152 where id = 'avatars'$q$;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute $q$update storage.buckets set allowed_mime_types = array['image/webp','image/jpeg','image/png'] where id = 'avatars'$q$;
  end if;
end $$;

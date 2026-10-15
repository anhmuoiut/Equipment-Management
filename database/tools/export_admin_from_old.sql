-- =============================================================================
-- export_admin_from_old.sql — Bước 1/2 chuyển tài khoản Admin sang project MỚI. CHỈ ĐỌC, không đổi gì.
--
-- Chạy trong SQL Editor của project CŨ:
--   1. Đổi 'ADMIN_USERNAME' ở dòng đầu thành username của Admin cần chuyển (đúng một chỗ).
--   2. Run. Kết quả là MỘT ô JSON (admin_export) gồm: dòng auth.users (kèm mật khẩu đã băm — bcrypt), các dòng auth.identities
--      và dòng public.user_profiles của Admin đó.
--   3. Sao chép ô đó, dán vào import_admin_to_new.sql (project MỚI).
--
-- !! Ô JSON chứa mật khẩu đã băm: KHÔNG dán vào chat, ticket hay git. Dán xong vào project mới thì xóa khỏi clipboard / file nháp.
-- Giữ nguyên id và mật khẩu → Admin đăng nhập project mới bằng đúng mật khẩu cũ; mọi created_by / updated_by về sau vẫn trỏ đúng.
-- =============================================================================

with pick as (select 'ADMIN_USERNAME'::text as username)
select jsonb_build_object(
  'format', 1,
  'exported_at', now(),
  'profile', (select to_jsonb(p) from public.user_profiles p, pick where p.username = pick.username),
  'user', (select to_jsonb(u) from auth.users u join public.user_profiles p on p.id = u.id, pick where p.username = pick.username),
  'identities', (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb)
                 from auth.identities i join public.user_profiles p on p.id = i.user_id, pick where p.username = pick.username)
) as admin_export;

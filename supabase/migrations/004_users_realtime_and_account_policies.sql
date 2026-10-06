DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.users;
  END IF;
END $$;

ALTER TABLE IF EXISTS public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select_self_or_admin ON public.users;
DROP POLICY IF EXISTS users_manage_admin ON public.users;

CREATE POLICY users_select_self_or_admin
ON public.users FOR SELECT TO authenticated
USING (auth_user_id = auth.uid() OR public.is_app_admin());

CREATE POLICY users_manage_admin
ON public.users FOR ALL TO authenticated
USING (public.is_app_admin())
WITH CHECK (public.is_app_admin());

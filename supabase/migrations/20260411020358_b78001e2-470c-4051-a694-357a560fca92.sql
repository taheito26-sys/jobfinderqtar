-- Drop the existing permissive ALL policy on user_preferences
DROP POLICY IF EXISTS "Users can manage own preferences" ON public.user_preferences;

-- Users can SELECT their own non-sensitive preferences
CREATE POLICY "Users can read own non-sensitive preferences"
ON public.user_preferences
FOR SELECT
USING (auth.uid() = user_id AND key NOT LIKE 'ai_api_key%');

-- Users can INSERT their own preferences
CREATE POLICY "Users can insert own preferences"
ON public.user_preferences
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can UPDATE their own preferences
CREATE POLICY "Users can update own preferences"
ON public.user_preferences
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Users can DELETE their own preferences
CREATE POLICY "Users can delete own preferences"
ON public.user_preferences
FOR DELETE
USING (auth.uid() = user_id);

-- Service role can read all preferences (needed by edge functions to read API keys)
CREATE POLICY "Service role full access preferences"
ON public.user_preferences
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
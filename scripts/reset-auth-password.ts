import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const userId = process.env.TARGET_USER_ID;
const password = process.env.NEW_PASSWORD;

if (!supabaseUrl || !serviceRoleKey || !userId || !password) {
  console.error(
    'Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TARGET_USER_ID, NEW_PASSWORD',
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const run = async () => {
  const { data, error } = await supabase.auth.admin.updateUserById(userId, {
    password,
  });

  if (error) {
    console.error('Password reset failed:', error.message);
    process.exit(1);
  }

  console.log(JSON.stringify({ id: data.user?.id, email: data.user?.email, ok: true }, null, 2));
};

run().catch((error) => {
  console.error('Unexpected failure:', error?.message ?? error);
  process.exit(1);
});

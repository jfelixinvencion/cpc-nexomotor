import { supabaseAdmin } from "@/lib/supabase/admin";

const TOKEN_KEY = "sigma";

export async function getStoredToken(): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("sigma_tokens")
    .select("access_token")
    .eq("key", TOKEN_KEY)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.access_token ?? null;
}

export async function setStoredToken(
  accessToken: string,
  refreshToken?: string
): Promise<void> {
  const { error } = await supabaseAdmin.from("sigma_tokens").upsert(
    {
      key: TOKEN_KEY,
      access_token: accessToken,
      refresh_token: refreshToken ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );

  if (error) {
    throw new Error(error.message);
  }
}

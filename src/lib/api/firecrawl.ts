import { supabase } from '@/integrations/supabase/client';

export type ScrapedJob = {
  title: string;
  company: string;
  location: string;
  remote_type: string;
  description: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  employment_type: string;
  seniority_level: string;
  requirements: string[];
  apply_url: string;
};

export const scrapeJobUrl = async (url: string): Promise<{ success: boolean; job?: ScrapedJob; error?: string }> => {
  const { data, error } = await supabase.functions.invoke('scrape-job-url', {
    body: { url },
  });

  if (error) {
    return { success: false, error: error.message };
  }

  if (data?.error) {
    return { success: false, error: data.error };
  }

  return { success: true, job: data.job };
};

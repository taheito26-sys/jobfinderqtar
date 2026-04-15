import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { scrapeJobUrl, ScrapedJob } from '@/lib/api/firecrawl';
import { buildHardlineJobInsert, buildHardlineJobScoreInsert, candidateProfileRowToHardlineProfile, recordHardlineSourceSyncBatch } from '@/lib/hardline-import';
import { DEFAULT_HARDLINE_POLICY } from '@/lib/hardline';
import { Loader2, Globe, Check, Linkedin, ClipboardPaste, CheckCircle2 } from 'lucide-react';

interface ImportJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJobAdded: (job: any) => void;
}

const QATAR_JOB_BOARDS = [
  { name: 'Indeed Qatar', url: 'https://qa.indeed.com' },
  { name: 'Bayt.com', url: 'https://www.bayt.com' },
  { name: 'GulfTalent', url: 'https://www.gulftalent.com' },
  { name: 'Naukrigulf', url: 'https://www.naukrigulf.com' },
  { name: 'LinkedIn', url: 'https://www.linkedin.com/jobs' },
  { name: 'Tanqeeb', url: 'https://www.tanqeeb.com' },
];

function isLinkedInUrl(url: string): boolean {
  try { return new URL(url).hostname.includes('linkedin.com'); } catch { return false; }
}

function normalizeLinkedInJobUrl(url: string): string {
  try {
    const u = new URL(url);
    const jobIdMatch = u.pathname.match(/\/jobs\/view\/(\d+)/) ||
                       u.pathname.match(/\/jobs\/(\d+)/) ||
                       url.match(/currentJobId=(\d+)/);
    if (jobIdMatch) return `https://www.linkedin.com/jobs/view/${jobIdMatch[1]}/`;
    return url;
  } catch { return url; }
}

/** Scrape via edge function with manual description support */
async function scrapeOrParse(url: string, manualDescription?: string): Promise<{
  success: boolean;
  job?: ScrapedJob;
  jobs?: ScrapedJob[];
  multiple?: boolean;
  total_found?: number;
  failed_count?: number;
  error?: string;
  linkedinLoginRequired?: boolean;
}> {
  const { data, error } = await supabase.functions.invoke('scrape-job-url', {
    body: manualDescription ? { url, manualDescription } : { url },
  });

  if (error) {
    return { success: false, error: error.message };
  }
  if (data?.error === 'LINKEDIN_LOGIN_REQUIRED') {
    return { success: false, error: data.message, linkedinLoginRequired: true };
  }
  if (data?.error) {
    return { success: false, error: data.error };
  }
  // Multiple jobs from LinkedIn search URL
  if (data?.multiple && Array.isArray(data?.jobs)) {
    return {
      success: true,
      multiple: true,
      jobs: data.jobs,
      total_found: data.total_found,
      failed_count: data.failed_count,
    };
  }
  return { success: true, job: data.job };
}

const ImportJobDialog = ({ open, onOpenChange, onJobAdded }: ImportJobDialogProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [url, setUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  // Single job mode
  const [scraped, setScraped] = useState<ScrapedJob | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editedJob, setEditedJob] = useState<ScrapedJob | null>(null);
  // Multi-job mode
  const [multiJobs, setMultiJobs] = useState<ScrapedJob[]>([]);
  const [multiSelected, setMultiSelected] = useState<Set<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const [activeTab, setActiveTab] = useState('url');
  const [pastedDescription, setPastedDescription] = useState('');

  const isLinkedin = isLinkedInUrl(url);
  const isMultiMode = multiJobs.length > 0;

  const handleScrape = async () => {
    if (!url.trim()) return;
    setScraping(true);
    setScraped(null);
    setMultiJobs([]);
    setMultiSelected(new Set());

    const normalizedUrl = isLinkedin ? url.trim() : url.trim(); // Keep full URL for search pages
    const result = await scrapeOrParse(normalizedUrl);

    if (result.linkedinLoginRequired) {
      setActiveTab('paste');
      toast({ title: 'LinkedIn login required', description: 'Paste the job description below instead.', variant: 'destructive' });
    } else if (result.multiple && result.jobs && result.jobs.length > 0) {
      // Multi-job result from LinkedIn search URL
      setMultiJobs(result.jobs);
      setMultiSelected(new Set(result.jobs.map((_, i) => i)));
      const failedMsg = result.failed_count ? ` (${result.failed_count} could not be extracted)` : '';
      toast({ title: `Found ${result.jobs.length} jobs!`, description: `Select which jobs to import${failedMsg}` });
    } else if (result.success && result.job) {
      setScraped(result.job);
      setEditedJob(result.job);
      toast({ title: 'Job extracted!', description: `Found: ${result.job.title} at ${result.job.company}` });
    } else {
      toast({ title: 'Scrape failed', description: result.error || 'Could not extract job data', variant: 'destructive' });
    }
    setScraping(false);
  };

  const handlePasteExtract = async () => {
    if (!pastedDescription.trim() || pastedDescription.trim().length < 50) {
      toast({ title: 'Too short', description: 'Please paste a complete job description (at least 50 characters).', variant: 'destructive' });
      return;
    }
    setScraping(true);
    setScraped(null);

    const result = await scrapeOrParse(url || '', pastedDescription.trim());

    if (result.success && result.job) {
      setScraped(result.job);
      setEditedJob(result.job);
      toast({ title: 'Job extracted!', description: `Found: ${result.job.title} at ${result.job.company}` });
    } else {
      toast({ title: 'Extraction failed', description: result.error || 'Could not parse job data', variant: 'destructive' });
    }
    setScraping(false);
  };

  const toggleMultiSelect = (idx: number) => {
    const next = new Set(multiSelected);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    setMultiSelected(next);
  };

  const toggleAllMulti = () => {
    if (multiSelected.size === multiJobs.length) {
      setMultiSelected(new Set());
    } else {
      setMultiSelected(new Set(multiJobs.map((_, i) => i)));
    }
  };

  const handleMultiImport = async () => {
    if (!user || multiSelected.size === 0) return;
    setImporting(true);
    try {
      // Check for duplicates
      const { data: existingJobs } = await supabase
        .from('jobs')
        .select('id, title, company, apply_url')
        .eq('user_id', user.id);

      const existingUrls = new Set((existingJobs || []).map(j => j.apply_url).filter(Boolean));
      const existingKeys = new Set((existingJobs || []).map(j => `${j.title?.toLowerCase()}|${j.company?.toLowerCase()}`));

      const selectedJobs = multiJobs.filter((_, i) => multiSelected.has(i));
      const deduped = selectedJobs.filter(job => {
        if (job.apply_url && existingUrls.has(job.apply_url)) return false;
        const key = `${job.title.toLowerCase()}|${job.company.toLowerCase()}`;
        if (existingKeys.has(key)) return false;
        return true;
      });

      const skipped = selectedJobs.length - deduped.length;

      const { data: candidateProfile } = await (supabase as any)
        .from('candidate_profile')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      const hardlineProfile = candidateProfileRowToHardlineProfile(candidateProfile as any);

      if (deduped.length === 0) {
        toast({ title: 'All duplicates', description: `${skipped} job(s) already exist in your feed.` });
        setConfirmOpen(false);
        return;
      }

      const insertData = deduped.map(job => buildHardlineJobInsert(user.id, job, {
        sourceLabel: 'linkedin_search',
        sourceData: { imported_from: url },
      }));

      const { data, error } = await (supabase as any).from('jobs').insert(insertData).select();
      if (error) throw error;

      try {
        await recordHardlineSourceSyncBatch((supabase as any), user.id, 'linkedin_search', 'linkedin', deduped, {
          baseUrl: url,
          config: { imported_from: url, source: 'linkedin_search' },
        });
      } catch (ledgerError) {
        console.warn('Ledger sync failed for LinkedIn multi import:', ledgerError);
      }

      if (data) {
        if (hardlineProfile && candidateProfile?.id) {
          const scoreRows = data.map((inserted: any, index: number) =>
            buildHardlineJobScoreInsert(
              user.id,
              inserted.id,
              candidateProfile.id,
              hardlineProfile,
              deduped[index],
              DEFAULT_HARDLINE_POLICY,
            )
          );
          const { error: scoreError } = await (supabase as any).from('job_scores').insert(scoreRows);
          if (scoreError) {
            console.warn('Hardline score insert failed:', scoreError.message);
          }
        }
        for (const d of data) {
          await supabase.from('application_events').insert({
            user_id: user.id, job_id: d.id, event_type: 'job_imported',
            metadata: { source: 'linkedin_search', source_url: url } as any,
          });
        }
        onJobAdded(data);
        const msg = skipped > 0
          ? `Imported ${data.length} jobs! (${skipped} duplicates skipped)`
          : `Imported ${data.length} jobs!`;
        toast({ title: msg });
        onOpenChange(false);
        resetState();
      }
    } catch (err: any) {
      toast({
        title: 'Import failed',
        description: err?.message || 'Could not save imported jobs.',
        variant: 'destructive',
      });
    } finally {
      setImporting(false);
      setConfirmOpen(false);
    }
  };

  const handleSave = async () => {
    if (!user || !editedJob) return;
    const sourceUrl = url.trim();
    const isLI = isLinkedInUrl(sourceUrl);
    try {
      const { data: existingJobs } = await supabase
        .from('jobs')
        .select('id, title, company, apply_url')
        .eq('user_id', user.id);

      const isDuplicate = (existingJobs || []).some(j => {
        if (sourceUrl && j.apply_url && j.apply_url === sourceUrl) return true;
        if (editedJob.apply_url && j.apply_url === editedJob.apply_url) return true;
        if (j.title?.toLowerCase() === editedJob.title.toLowerCase() &&
            j.company?.toLowerCase() === editedJob.company.toLowerCase()) return true;
        return false;
      });

      if (isDuplicate) {
        toast({ title: 'Duplicate job', description: 'This job already exists in your feed.', variant: 'destructive' });
        return;
      }

      const { data: candidateProfile } = await (supabase as any)
        .from('candidate_profile')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      const hardlineProfile = candidateProfileRowToHardlineProfile(candidateProfile as any);

      const { data, error } = await (supabase as any).from('jobs').insert(
        buildHardlineJobInsert(user.id, {
          ...editedJob,
          apply_url: editedJob.apply_url || sourceUrl,
          source_url: sourceUrl,
          source_created_at: editedJob.source_created_at || null,
        }, {
          sourceLabel: isLI ? 'linkedin' : 'web',
          sourceData: { imported_from: sourceUrl },
        })
      ).select().single();

      if (error) throw error;

      try {
        await recordHardlineSourceSyncBatch((supabase as any), user.id, isLI ? 'linkedin' : 'web', isLI ? 'linkedin' : 'web', [{
          ...editedJob,
          apply_url: editedJob.apply_url || sourceUrl,
          source_url: sourceUrl,
          source_created_at: editedJob.source_created_at || null,
        }], {
          baseUrl: sourceUrl,
          config: { imported_from: sourceUrl, source: isLI ? 'linkedin' : 'web' },
        });
      } catch (ledgerError) {
        console.warn('Ledger sync failed for single job import:', ledgerError);
      }

      if (hardlineProfile && candidateProfile?.id) {
        const scoreRow = buildHardlineJobScoreInsert(
          user.id,
          data.id,
          candidateProfile.id,
          hardlineProfile,
          {
            ...editedJob,
            apply_url: editedJob.apply_url || sourceUrl,
            source_url: sourceUrl,
            source_created_at: editedJob.source_created_at || null,
          },
          DEFAULT_HARDLINE_POLICY,
        );
        const { error: scoreError } = await (supabase as any).from('job_scores').insert(scoreRow);
        if (scoreError) {
          console.warn('Hardline score insert failed:', scoreError.message);
        }
      }
      await supabase.from('application_events').insert({
        user_id: user.id, job_id: data.id, event_type: 'job_imported',
        metadata: { source: isLI ? 'linkedin' : 'web', source_url: sourceUrl } as any,
      });
      onJobAdded(data);
      onOpenChange(false);
      resetState();
      toast({ title: isLI ? 'LinkedIn job imported!' : 'Job imported!' });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err?.message || 'Could not save imported job.',
        variant: 'destructive',
      });
    }
  };

  const resetState = () => {
    setUrl('');
    setScraped(null);
    setEditedJob(null);
    setEditMode(false);
    setPastedDescription('');
    setActiveTab('url');
    setMultiJobs([]);
    setMultiSelected(new Set());
    setConfirmOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetState(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5" />
            Import Job
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Supported boards */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">Import from any job board:</p>
            <div className="flex flex-wrap gap-1.5">
              {QATAR_JOB_BOARDS.map(board => (
                <Badge key={board.name} variant="outline" className="text-xs cursor-pointer hover:opacity-80"
                  onClick={() => window.open(board.url, '_blank')}>
                  {board.name}
                </Badge>
              ))}
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="url" className="flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5" /> From URL
              </TabsTrigger>
              <TabsTrigger value="paste" className="flex items-center gap-1.5">
                <ClipboardPaste className="w-3.5 h-3.5" /> Paste Description
              </TabsTrigger>
            </TabsList>

            <TabsContent value="url" className="space-y-3 mt-3">
              {isLinkedin && (
                <div className="flex items-start gap-2 p-3 rounded-lg border border-sky-200 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30">
                  <Linkedin className="w-4 h-4 text-[#0A66C2] mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">LinkedIn detected.</span> Search pages with multiple jobs will be extracted individually. Single job URLs work too.
                  </p>
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  placeholder="https://linkedin.com/jobs/view/... or any job URL"
                  value={url} onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleScrape()}
                  disabled={scraping}
                />
                <Button onClick={handleScrape} disabled={scraping || !url.trim()}>
                  {scraping ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Extract'}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="paste" className="space-y-3 mt-3">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Copy the full job posting from the website and paste it here. AI will extract the structured data.
                </Label>
                <Input
                  placeholder="Original job URL (optional)"
                  value={url} onChange={e => setUrl(e.target.value)}
                  className="text-sm"
                />
                <Textarea
                  placeholder="Paste the full job description here...&#10;&#10;e.g. Job Title: Senior Engineer&#10;Company: Acme Corp&#10;Location: Doha, Qatar&#10;..."
                  value={pastedDescription}
                  onChange={e => setPastedDescription(e.target.value)}
                  rows={8}
                  disabled={scraping}
                />
                <Button onClick={handlePasteExtract} disabled={scraping || pastedDescription.trim().length < 50} className="w-full">
                  {scraping ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Extracting...</> : 'Extract Job Data'}
                </Button>
              </div>
            </TabsContent>
          </Tabs>

          {/* Multi-job results */}
          {isMultiMode && (
            <div className="space-y-3 border border-border rounded-lg p-4 bg-muted/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-score-excellent" />
                  <span className="text-sm font-medium">{multiJobs.length} Jobs Found</span>
                  {isLinkedin ? (
                    <Badge variant="outline" className="text-xs bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800">
                      <Linkedin className="w-3 h-3 mr-1" /> LinkedIn
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">Multiple roles detected</Badge>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={toggleAllMulti}>
                  {multiSelected.size === multiJobs.length ? 'Deselect All' : 'Select All'}
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Each job below is a separate position — select the ones you want to add individually to your feed.
              </p>

              <div className="space-y-2 max-h-[320px] overflow-y-auto">
                {multiJobs.map((job, idx) => (
                  <div key={idx}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      multiSelected.has(idx)
                        ? 'border-primary/50 bg-primary/5'
                        : 'border-border hover:bg-muted/50'
                    }`}
                    onClick={() => toggleMultiSelect(idx)}
                  >
                    <Checkbox
                      checked={multiSelected.has(idx)}
                      onCheckedChange={() => toggleMultiSelect(idx)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-sm text-foreground truncate">{job.title}</h4>
                      <p className="text-xs text-muted-foreground truncate">{job.company} • {job.location || 'No location'}</p>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {job.remote_type !== 'unknown' && (
                          <Badge variant="outline" className="text-xs capitalize">{job.remote_type}</Badge>
                        )}
                        {job.employment_type && (
                          <Badge variant="secondary" className="text-xs capitalize">{job.employment_type}</Badge>
                        )}
                        {job.seniority_level && (
                          <Badge variant="outline" className="text-xs capitalize">{job.seniority_level}</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={multiSelected.size === 0 || importing}
                className="w-full"
              >
                {importing
                  ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Importing...</>
                  : `Import ${multiSelected.size} Job${multiSelected.size !== 1 ? 's' : ''}`
                }
              </Button>
            </div>
          )}

          {/* Single job result */}
          {scraped && editedJob && !isMultiMode && (
            <div className="space-y-3 border border-border rounded-lg p-4 bg-muted/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-score-excellent" />
                  <span className="text-sm font-medium">Job Extracted</span>
                  {isLinkedin && (
                    <Badge variant="outline" className="text-xs bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800">
                      <Linkedin className="w-3 h-3 mr-1" /> LinkedIn
                    </Badge>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => setEditMode(!editMode)}>
                  {editMode ? 'Preview' : 'Edit'}
                </Button>
              </div>

              {editMode ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Title</Label>
                      <Input value={editedJob.title} onChange={e => setEditedJob({ ...editedJob, title: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Company</Label>
                      <Input value={editedJob.company} onChange={e => setEditedJob({ ...editedJob, company: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Location</Label>
                      <Input value={editedJob.location} onChange={e => setEditedJob({ ...editedJob, location: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Remote Type</Label>
                      <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={editedJob.remote_type} onChange={e => setEditedJob({ ...editedJob, remote_type: e.target.value })}>
                        <option value="remote">Remote</option>
                        <option value="hybrid">Hybrid</option>
                        <option value="onsite">On-site</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Description</Label>
                    <Textarea value={editedJob.description} onChange={e => setEditedJob({ ...editedJob, description: e.target.value })} rows={4} />
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <h4 className="font-medium text-foreground">{editedJob.title}</h4>
                  <p className="text-sm text-muted-foreground">{editedJob.company} • {editedJob.location || 'No location'}</p>
                  {editedJob.remote_type !== 'unknown' && (
                    <Badge variant="outline" className="text-xs capitalize">{editedJob.remote_type}</Badge>
                  )}
                  {editedJob.salary_min && (
                    <p className="text-xs text-muted-foreground">
                      Salary: {editedJob.salary_currency || ''} {editedJob.salary_min?.toLocaleString()}
                      {editedJob.salary_max ? ` - ${editedJob.salary_max.toLocaleString()}` : ''}
                    </p>
                  )}
                  {editedJob.requirements.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {editedJob.requirements.slice(0, 5).map((r, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">{r}</Badge>
                      ))}
                      {editedJob.requirements.length > 5 && (
                        <Badge variant="secondary" className="text-xs">+{editedJob.requirements.length - 5}</Badge>
                      )}
                    </div>
                  )}
                </div>
              )}

              <Button onClick={handleSave} className="w-full">Save to Job Feed</Button>
            </div>
          )}
        </div>
      </DialogContent>

      {/* Confirmation dialog for multi-import */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Import</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-3">You are about to import <strong>{multiSelected.size}</strong> job{multiSelected.size !== 1 ? 's' : ''}:</p>
                <div className="max-h-[200px] overflow-y-auto space-y-1.5">
                  {multiJobs.filter((_, i) => multiSelected.has(i)).map((job, idx) => (
                    <div key={idx} className="text-sm flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                      <span className="truncate"><strong>{job.title}</strong> at {job.company}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">Duplicates will be automatically skipped.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={importing}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleMultiImport} disabled={importing}>
              {importing ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Importing...</> : 'Confirm Import'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
};

export default ImportJobDialog;

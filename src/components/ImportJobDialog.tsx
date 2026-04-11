import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { scrapeJobUrl, ScrapedJob } from '@/lib/api/firecrawl';
import { Loader2, Globe, Check, Linkedin, ClipboardPaste } from 'lucide-react';

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
async function scrapeOrParse(url: string, manualDescription?: string): Promise<{ success: boolean; job?: ScrapedJob; error?: string; linkedinLoginRequired?: boolean }> {
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
  return { success: true, job: data.job };
}

const ImportJobDialog = ({ open, onOpenChange, onJobAdded }: ImportJobDialogProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [url, setUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [scraped, setScraped] = useState<ScrapedJob | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editedJob, setEditedJob] = useState<ScrapedJob | null>(null);
  const [activeTab, setActiveTab] = useState('url');
  const [pastedDescription, setPastedDescription] = useState('');

  const isLinkedin = isLinkedInUrl(url);

  const handleScrape = async () => {
    if (!url.trim()) return;
    setScraping(true);
    setScraped(null);

    const normalizedUrl = isLinkedin ? normalizeLinkedInJobUrl(url) : url;
    const result = await scrapeOrParse(normalizedUrl);

    if (result.linkedinLoginRequired) {
      setActiveTab('paste');
      toast({ title: 'LinkedIn login required', description: 'Paste the job description below instead.', variant: 'destructive' });
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

  const handleSave = async () => {
    if (!user || !editedJob) return;
    const sourceUrl = url.trim();
    const isLI = isLinkedInUrl(sourceUrl);

    const { data, error } = await supabase.from('jobs').insert({
      user_id: user.id,
      title: editedJob.title,
      company: editedJob.company,
      location: editedJob.location,
      remote_type: editedJob.remote_type,
      description: editedJob.description,
      salary_min: editedJob.salary_min,
      salary_max: editedJob.salary_max,
      salary_currency: editedJob.salary_currency,
      employment_type: editedJob.employment_type,
      seniority_level: editedJob.seniority_level,
      requirements: editedJob.requirements as any,
      apply_url: editedJob.apply_url || sourceUrl,
      source_url: sourceUrl,
      raw_data: { source: isLI ? 'linkedin' : 'web', imported_from: sourceUrl } as any,
    }).select().single();

    if (data) {
      await supabase.from('application_events').insert({
        user_id: user.id, job_id: data.id, event_type: 'job_imported',
        metadata: { source: isLI ? 'linkedin' : 'web', source_url: sourceUrl } as any,
      });
      onJobAdded(data);
      onOpenChange(false);
      resetState();
      toast({ title: isLI ? 'LinkedIn job imported!' : 'Job imported!' });
    }
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const resetState = () => {
    setUrl('');
    setScraped(null);
    setEditedJob(null);
    setEditMode(false);
    setPastedDescription('');
    setActiveTab('url');
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
                    <span className="font-medium text-foreground">LinkedIn job detected.</span> If auto-extract fails, switch to "Paste Description" and copy the job details from LinkedIn.
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

          {/* Results */}
          {scraped && editedJob && (
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
    </Dialog>
  );
};

export default ImportJobDialog;

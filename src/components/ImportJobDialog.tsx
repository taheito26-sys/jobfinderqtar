import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { scrapeJobUrl, ScrapedJob } from '@/lib/api/firecrawl';
import { Loader2, Globe, Check, AlertCircle } from 'lucide-react';

interface ImportJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJobAdded: (job: any) => void;
}

const QATAR_JOB_BOARDS = [
  { name: 'Indeed Qatar', url: 'https://qa.indeed.com', color: 'bg-blue-100 text-blue-800' },
  { name: 'Bayt.com', url: 'https://www.bayt.com', color: 'bg-green-100 text-green-800' },
  { name: 'GulfTalent', url: 'https://www.gulftalent.com', color: 'bg-orange-100 text-orange-800' },
  { name: 'Naukrigulf', url: 'https://www.naukrigulf.com', color: 'bg-red-100 text-red-800' },
  { name: 'LinkedIn', url: 'https://www.linkedin.com/jobs', color: 'bg-sky-100 text-sky-800' },
  { name: 'Tanqeeb', url: 'https://www.tanqeeb.com', color: 'bg-purple-100 text-purple-800' },
];

const ImportJobDialog = ({ open, onOpenChange, onJobAdded }: ImportJobDialogProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [url, setUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [scraped, setScraped] = useState<ScrapedJob | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editedJob, setEditedJob] = useState<ScrapedJob | null>(null);

  const handleScrape = async () => {
    if (!url.trim()) return;
    setScraping(true);
    setScraped(null);

    const result = await scrapeJobUrl(url);

    if (result.success && result.job) {
      setScraped(result.job);
      setEditedJob(result.job);
      toast({ title: 'Job extracted!', description: `Found: ${result.job.title} at ${result.job.company}` });
    } else {
      toast({ title: 'Scrape failed', description: result.error || 'Could not extract job data', variant: 'destructive' });
    }

    setScraping(false);
  };

  const handleSave = async () => {
    if (!user || !editedJob) return;

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
      apply_url: editedJob.apply_url,
    }).select().single();

    if (data) {
      onJobAdded(data);
      onOpenChange(false);
      resetState();
      toast({ title: 'Job imported!' });
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
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetState(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5" />
            Import Job from URL
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Supported boards */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">Paste a job listing URL from any site. Works best with:</p>
            <div className="flex flex-wrap gap-1.5">
              {QATAR_JOB_BOARDS.map(board => (
                <Badge key={board.name} variant="outline" className="text-xs cursor-pointer hover:opacity-80"
                  onClick={() => window.open(board.url, '_blank')}>
                  {board.name}
                </Badge>
              ))}
            </div>
          </div>

          {/* URL input */}
          <div className="flex gap-2">
            <Input
              placeholder="https://qa.indeed.com/viewjob?jk=..."
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleScrape()}
              disabled={scraping}
            />
            <Button onClick={handleScrape} disabled={scraping || !url.trim()}>
              {scraping ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Extract'}
            </Button>
          </div>

          {/* Results */}
          {scraped && editedJob && (
            <div className="space-y-3 border border-border rounded-lg p-4 bg-muted/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-score-excellent" />
                  <span className="text-sm font-medium">Job Extracted</span>
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

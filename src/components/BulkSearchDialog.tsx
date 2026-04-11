import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Search, MapPin, Building2, Plus, CheckCircle2 } from 'lucide-react';

interface SearchResult {
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
  source_url: string;
}

interface BulkSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJobsAdded: (jobs: any[]) => void;
}

const QUICK_SEARCHES = [
  'Software Engineer Qatar',
  'Project Manager Doha',
  'Data Analyst Qatar',
  'Marketing Manager Doha',
  'Mechanical Engineer Qatar',
  'Finance Analyst Doha',
];

const BulkSearchDialog = ({ open, onOpenChange, onJobsAdded }: BulkSearchDialogProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<Set<number>>(new Set());

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setResults([]);
    setSelected(new Set());
    setImported(new Set());

    try {
      const { data, error } = await supabase.functions.invoke('search-jobs', {
        body: { query: query.trim(), limit: 15 },
      });

      if (error) {
        toast({ title: 'Search failed', description: error.message, variant: 'destructive' });
      } else if (data?.jobs?.length > 0) {
        setResults(data.jobs);
        // Auto-select all
        setSelected(new Set(data.jobs.map((_: any, i: number) => i)));
        toast({ title: `Found ${data.jobs.length} jobs` });
      } else {
        toast({ title: 'No results', description: 'Try a different search query.' });
      }
    } catch {
      toast({ title: 'Error', description: 'Search failed', variant: 'destructive' });
    }

    setSearching(false);
  };

  const toggleSelect = (idx: number) => {
    const next = new Set(selected);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === results.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(results.map((_, i) => i)));
    }
  };

  const handleImport = async () => {
    if (!user || selected.size === 0) return;
    setImporting(true);

    const toImport = results.filter((_, i) => selected.has(i) && !imported.has(i));
    const insertData = toImport.map(job => ({
      user_id: user.id,
      title: job.title,
      company: job.company,
      location: job.location,
      remote_type: job.remote_type,
      description: job.description,
      salary_min: job.salary_min,
      salary_max: job.salary_max,
      salary_currency: job.salary_currency,
      employment_type: job.employment_type,
      seniority_level: job.seniority_level,
      requirements: job.requirements as any,
      apply_url: job.apply_url,
    }));

    const { data, error } = await supabase.from('jobs').insert(insertData).select();

    if (data) {
      const newImported = new Set(imported);
      results.forEach((_, i) => { if (selected.has(i)) newImported.add(i); });
      setImported(newImported);
      onJobsAdded(data);
      toast({ title: `Imported ${data.length} jobs!` });
    }
    if (error) {
      toast({ title: 'Import error', description: error.message, variant: 'destructive' });
    }

    setImporting(false);
  };

  const resetState = () => {
    setQuery('');
    setResults([]);
    setSelected(new Set());
    setImported(new Set());
  };

  const unimportedSelected = [...selected].filter(i => !imported.has(i)).length;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetState(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="w-5 h-5" />
            Bulk Job Search
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Quick searches */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">Quick searches:</p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_SEARCHES.map(q => (
                <Badge key={q} variant="outline" className="text-xs cursor-pointer hover:bg-accent"
                  onClick={() => { setQuery(q); }}>
                  {q}
                </Badge>
              ))}
            </div>
          </div>

          {/* Search input */}
          <div className="flex gap-2">
            <Input
              placeholder='e.g. "Software Engineer Qatar"'
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              disabled={searching}
            />
            <Button onClick={handleSearch} disabled={searching || !query.trim()}>
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
            </Button>
          </div>

          {/* Results */}
          {searching && (
            <div className="text-center py-8 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              <p className="text-sm">Searching job boards...</p>
            </div>
          )}

          {results.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={selected.size === results.length}
                    onCheckedChange={toggleAll}
                  />
                  <span className="text-sm text-muted-foreground">
                    {selected.size} of {results.length} selected
                  </span>
                </div>
                <Button onClick={handleImport} disabled={importing || unimportedSelected === 0} size="sm">
                  {importing ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importing...</>
                  ) : (
                    <><Plus className="w-4 h-4 mr-2" />Import {unimportedSelected} Jobs</>
                  )}
                </Button>
              </div>

              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {results.map((job, idx) => {
                  const isImported = imported.has(idx);
                  return (
                    <div
                      key={idx}
                      className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                        isImported ? 'bg-muted/50 border-muted opacity-60' :
                        selected.has(idx) ? 'border-primary/30 bg-primary/5' : 'border-border'
                      }`}
                    >
                      {isImported ? (
                        <CheckCircle2 className="w-5 h-5 text-score-excellent mt-0.5 flex-shrink-0" />
                      ) : (
                        <Checkbox
                          checked={selected.has(idx)}
                          onCheckedChange={() => toggleSelect(idx)}
                          className="mt-0.5"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-sm text-foreground truncate">{job.title}</h4>
                        <p className="text-xs text-muted-foreground flex items-center gap-2">
                          <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{job.company}</span>
                          {job.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{job.location}</span>}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {job.remote_type !== 'unknown' && (
                            <Badge variant="outline" className="text-[10px] capitalize">{job.remote_type}</Badge>
                          )}
                          {job.employment_type && (
                            <Badge variant="secondary" className="text-[10px] capitalize">{job.employment_type}</Badge>
                          )}
                          {job.salary_min && (
                            <Badge variant="secondary" className="text-[10px]">
                              {job.salary_currency || ''} {job.salary_min?.toLocaleString()}{job.salary_max ? ` - ${job.salary_max.toLocaleString()}` : ''}
                            </Badge>
                          )}
                        </div>
                        {isImported && <span className="text-[10px] text-score-excellent font-medium">Imported ✓</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BulkSearchDialog;

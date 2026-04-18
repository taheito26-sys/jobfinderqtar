import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { FileSearch, Loader2, CheckCircle2, AlertCircle, XCircle, Sparkles, Wrench } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

interface ATSScoreCheckerProps {
  jobId: string;
  jobTitle: string;
  jobRequirements: any[];
  userId: string;
}

interface ATSResult {
  overall_score: number;
  keyword_match: number;
  format_score: number;
  sections_score: number;
  matched_keywords: string[];
  missing_keywords: string[];
  suggestions: string[];
  fixes: ATSFix[];
}

interface ATSFix {
  id: string;
  label: string;
  description: string;
  type: 'add_skill' | 'add_summary' | 'add_experience';
  data?: any;
}

const ATSScoreChecker = ({ jobId, jobTitle, jobRequirements, userId }: ATSScoreCheckerProps) => {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ATSResult | null>(null);
  const [selectedFixIds, setSelectedFixIds] = useState<string[]>([]);
  const [tailoring, setTailoring] = useState(false);

  const runCheck = async () => {
    setChecking(true);
    setResult(null);
    setSelectedFixIds([]);

    try {
      const { data: docs } = await supabase.from('master_documents')
        .select('*').eq('user_id', userId).eq('is_primary', true).limit(1);

      if (!docs || docs.length === 0) {
        toast.error('No primary CV found. Upload a CV first.');
        setChecking(false);
        return;
      }

      const cv = docs[0];
      const parsedContent = (cv.parsed_content || {}) as Record<string, any>;

      const { data: skills } = await supabase.from('profile_skills')
        .select('skill_name').eq('user_id', userId);
      const userSkills = (skills || []).map(s => s.skill_name.toLowerCase());

      const { data: employment } = await supabase.from('employment_history')
        .select('title, description, achievements').eq('user_id', userId);

      const { data: education } = await supabase.from('education_history')
        .select('id').eq('user_id', userId);

      const userText = [
        parsedContent.summary || '',
        parsedContent.headline || '',
        ...userSkills,
        ...(employment || []).flatMap(e => [
          e.title || '',
          e.description || '',
          ...(Array.isArray(e.achievements) ? e.achievements : []),
        ]),
      ].join(' ').toLowerCase();

      const requirements = Array.isArray(jobRequirements) ? jobRequirements : [];
      const reqKeywords = requirements.map(r => (typeof r === 'string' ? r : String(r)).toLowerCase().trim()).filter(Boolean);

      const matched: string[] = [];
      const missing: string[] = [];

      reqKeywords.forEach(kw => {
        const words = kw.split(/\s+/);
        const found = words.some(w => userText.includes(w)) ||
                      userSkills.some(s => s.includes(kw) || kw.includes(s));
        if (found) matched.push(kw);
        else missing.push(kw);
      });

      const keywordMatch = reqKeywords.length > 0
        ? Math.round((matched.length / reqKeywords.length) * 100)
        : 50;

      const hasSummary = !!(parsedContent.summary && parsedContent.summary.length > 20);
      const hasSkills = userSkills.length >= 3;
      const hasExperience = (employment || []).length >= 1;
      const hasEducation = (education || []).length >= 1;
      const formatChecks = [hasSummary, hasSkills, hasExperience];
      const formatScore = Math.round((formatChecks.filter(Boolean).length / formatChecks.length) * 100);

      const sections = ['summary', 'skills', 'employment', 'education'];
      const presentSections = sections.filter(s => {
        if (s === 'summary') return hasSummary;
        if (s === 'skills') return hasSkills;
        if (s === 'employment') return hasExperience;
        if (s === 'education') return hasEducation;
        return false;
      });
      const sectionsScore = Math.round((presentSections.length / sections.length) * 100);

      const overallScore = Math.round(keywordMatch * 0.5 + formatScore * 0.25 + sectionsScore * 0.25);

      // Build actionable fixes
      const fixes: ATSFix[] = [];

      // Fix: add missing keywords as skills
      missing.forEach((kw, i) => {
        fixes.push({
          id: `skill-${i}`,
          label: `Add "${kw}" to skills`,
          description: `This keyword from the job requirements is missing from your profile. Adding it as a skill will improve your keyword match score.`,
          type: 'add_skill',
          data: { skill_name: kw },
        });
      });

      // Fix: add summary if missing
      if (!hasSummary) {
        fixes.push({
          id: 'summary',
          label: 'Add a professional summary',
          description: 'A summary section of 2-3 sentences helps ATS systems understand your profile and improves format score.',
          type: 'add_summary',
        });
      }

      // Fix: add experience if missing
      if (!hasExperience) {
        fixes.push({
          id: 'experience',
          label: 'Add work experience',
          description: 'At least one employment entry is needed for a complete CV structure.',
          type: 'add_experience',
        });
      }

      const suggestions: string[] = [];
      if (overallScore >= 80) suggestions.push('Great match! Your CV is well-aligned with this position.');
      if (missing.length > 0 && overallScore < 80) suggestions.push(`${missing.length} required keyword(s) are missing — use the fix buttons below to add them.`);
      if (!hasSummary) suggestions.push('Add a professional summary to improve format score.');
      if (userSkills.length < 5) suggestions.push('Consider adding more relevant skills to your profile.');

      setResult({
        overall_score: overallScore,
        keyword_match: keywordMatch,
        format_score: formatScore,
        sections_score: sectionsScore,
        matched_keywords: matched,
        missing_keywords: missing,
        suggestions,
        fixes,
      });

      toast.success(`ATS Score: ${overallScore}%`);
    } catch (err: any) {
      toast.error('ATS check failed: ' + (err.message || 'Unknown error'));
    }

    setChecking(false);
  };

  const selectedFixes = useMemo(
    () => result?.fixes.filter(f => selectedFixIds.includes(f.id)) ?? [],
    [result, selectedFixIds],
  );

  const toggleFixSelection = (fixId: string, checked: boolean) => {
    setSelectedFixIds(prev => checked ? [...prev, fixId] : prev.filter(id => id !== fixId));
  };

  const tailorWithSelectedFixes = async () => {
    if (!result) return;
    setTailoring(true);
    try {
      const { data, error } = await supabase.functions.invoke('tailor-cv', {
        body: {
          job_id: jobId,
          document_type: 'cv',
          ats_fixes: selectedFixes,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const fixCount = selectedFixes.length;
      toast.success(
        fixCount > 0
          ? `Tailored CV created with ${fixCount} ATS-approved fix${fixCount === 1 ? '' : 'es'}.`
          : 'Tailored CV created without ATS fixes.',
      );
      navigate('/tailoring');
    } catch (err: any) {
      toast.error('Tailoring failed: ' + (err.message || 'Unknown error'));
    } finally {
      setTailoring(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-score-excellent';
    if (score >= 60) return 'text-score-good';
    if (score >= 40) return 'text-score-fair';
    return 'text-score-poor';
  };

  const getScoreLabel = (score: number) => {
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Needs Work';
    return 'Poor Match';
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileSearch className="w-4 h-4 text-primary" />
          ATS Compatibility Score
        </CardTitle>
        <CardDescription className="text-xs">
          Check how well your CV matches this job's requirements for ATS systems
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!result ? (
          <Button onClick={runCheck} disabled={checking} className="w-full gap-1.5" variant="outline" size="sm">
            {checking ? (
              <><Loader2 className="w-4 h-4 animate-spin" />Scanning CV...</>
            ) : (
              <><Sparkles className="w-4 h-4" />Check ATS Score</>
            )}
          </Button>
        ) : (
          <>
            {/* Overall Score */}
            <div className="text-center py-2">
              <div className={`text-4xl font-bold ${getScoreColor(result.overall_score)}`}>
                {result.overall_score}%
              </div>
              <Badge variant={result.overall_score >= 70 ? 'default' : 'secondary'} className="mt-1">
                {getScoreLabel(result.overall_score)}
              </Badge>
            </div>

            <Separator />

            {/* Sub-scores */}
            <div className="space-y-2">
              <ScoreBar label="Keyword Match" score={result.keyword_match} />
              <ScoreBar label="Format & Structure" score={result.format_score} />
              <ScoreBar label="Section Completeness" score={result.sections_score} />
            </div>

            <Separator />

            {/* Keywords */}
            {result.matched_keywords.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Matched Keywords</p>
                <div className="flex flex-wrap gap-1">
                  {result.matched_keywords.slice(0, 8).map(k => (
                    <Badge key={k} variant="outline" className="text-[10px] border-score-excellent/30 text-score-excellent">
                      <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />{k}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {result.missing_keywords.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Missing Keywords</p>
                <div className="flex flex-wrap gap-1">
                  {result.missing_keywords.slice(0, 8).map(k => (
                    <Badge key={k} variant="outline" className="text-[10px] border-score-poor/30 text-score-poor">
                      <XCircle className="w-2.5 h-2.5 mr-0.5" />{k}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <Separator />

            {/* Actionable Fixes */}
            {result.fixes.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <Wrench className="w-3 h-3" /> ATS Fixes for Tailoring
                  </p>
                </div>
                <p className="text-[11px] text-muted-foreground mb-2">
                  Check the fixes you want reflected in the tailored CV. They will not change your saved profile unless you save them separately.
                </p>
                <div className="space-y-1.5 max-h-44 overflow-y-auto">
                  {result.fixes.slice(0, 10).map(fix => {
                    const checked = selectedFixIds.includes(fix.id);
                    return (
                      <label key={fix.id} className="flex items-start gap-2 p-2 rounded-md bg-muted/50 border border-border cursor-pointer">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) => toggleFixSelection(fix.id, value === true)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-foreground truncate">{fix.label}</p>
                          <p className="text-[10px] text-muted-foreground line-clamp-2">{fix.description}</p>
                          {fix.type === 'add_experience' && (
                            <p className="text-[10px] text-amber-600 mt-0.5">
                              This will only be reflected if your profile already supports it.
                            </p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="rounded-md border border-blue-200 bg-blue-50/70 p-3 text-[11px] text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
              Selected fixes will be applied only to the tailored CV. Leave them unchecked to tailor the CV exactly from your current profile.
            </div>

            {selectedFixes.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-score-excellent">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{selectedFixes.length} selected fix(es) will be shown in the tailored CV changes summary.</span>
              </div>
            )}

            <Separator />

            {/* Suggestions */}
            {result.suggestions.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Suggestions</p>
                <div className="space-y-1.5">
                  {result.suggestions.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <AlertCircle className="w-3 h-3 text-primary mt-0.5 flex-shrink-0" />
                      <span className="text-foreground">{s}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Button
                onClick={tailorWithSelectedFixes}
                variant="default"
                size="sm"
                className="w-full gap-1.5 mt-2"
                disabled={tailoring}
              >
                {tailoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Tailor CV with selected fixes
              </Button>
              <Button onClick={runCheck} variant="outline" size="sm" className="w-full gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />Re-check
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

const ScoreBar = ({ label, score }: { label: string; score: number }) => (
  <div className="space-y-1">
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{score}%</span>
    </div>
    <Progress value={score} className="h-1.5" />
  </div>
);

export default ATSScoreChecker;

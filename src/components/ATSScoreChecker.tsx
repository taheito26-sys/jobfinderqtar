import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { FileSearch, Loader2, CheckCircle2, AlertCircle, XCircle, Sparkles, Wrench, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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
  applied?: boolean;
}

const ATSScoreChecker = ({ jobId, jobTitle, jobRequirements, userId }: ATSScoreCheckerProps) => {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ATSResult | null>(null);

  const runCheck = async () => {
    setChecking(true);
    setResult(null);

    try {
      // Get user's primary CV
      const { data: docs } = await supabase.from('master_documents')
        .select('*').eq('user_id', userId).eq('is_primary', true).limit(1);

      if (!docs || docs.length === 0) {
        toast.error('No primary CV found. Upload a CV first.');
        setChecking(false);
        return;
      }

      const cv = docs[0];
      const parsedContent = (cv.parsed_content || {}) as Record<string, any>;

      // Get user skills
      const { data: skills } = await supabase.from('profile_skills')
        .select('skill_name').eq('user_id', userId);
      const userSkills = (skills || []).map(s => s.skill_name.toLowerCase());

      // Get employment
      const { data: employment } = await supabase.from('employment_history')
        .select('title, description, achievements').eq('user_id', userId);

      // Build user text corpus
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

      // Extract keywords from requirements
      const requirements = Array.isArray(jobRequirements) ? jobRequirements : [];
      const reqKeywords = requirements.map(r => (typeof r === 'string' ? r : String(r)).toLowerCase().trim()).filter(Boolean);

      // Calculate matches
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

      // Format score — check for key sections
      const hasSummary = !!(parsedContent.summary && parsedContent.summary.length > 20);
      const hasSkills = userSkills.length >= 3;
      const hasExperience = (employment || []).length >= 1;
      const formatChecks = [hasSummary, hasSkills, hasExperience];
      const formatScore = Math.round((formatChecks.filter(Boolean).length / formatChecks.length) * 100);

      // Sections score
      const sections = ['summary', 'skills', 'employment', 'education'];
      const presentSections = sections.filter(s => {
        if (s === 'summary') return hasSummary;
        if (s === 'skills') return hasSkills;
        if (s === 'employment') return hasExperience;
        if (s === 'education') return true; // assume present
        return false;
      });
      const sectionsScore = Math.round((presentSections.length / sections.length) * 100);

      const overallScore = Math.round(keywordMatch * 0.5 + formatScore * 0.25 + sectionsScore * 0.25);

      // Generate suggestions
      const suggestions: string[] = [];
      if (missing.length > 0) {
        suggestions.push(`Add these missing keywords to your CV: ${missing.slice(0, 5).join(', ')}`);
      }
      if (!hasSummary) suggestions.push('Add a professional summary of at least 2-3 sentences');
      if (userSkills.length < 5) suggestions.push('Add more relevant skills to your profile');
      if (keywordMatch < 60) suggestions.push('Your CV needs more alignment with this job\'s requirements');
      if (overallScore >= 80) suggestions.push('Great match! Your CV is well-aligned with this position');

      setResult({
        overall_score: overallScore,
        keyword_match: keywordMatch,
        format_score: formatScore,
        sections_score: sectionsScore,
        matched_keywords: matched,
        missing_keywords: missing,
        suggestions,
      });

      toast.success(`ATS Score: ${overallScore}%`);
    } catch (err: any) {
      toast.error('ATS check failed: ' + (err.message || 'Unknown error'));
    }

    setChecking(false);
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

            {/* Suggestions */}
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

            <Button onClick={runCheck} variant="outline" size="sm" className="w-full gap-1.5 mt-2">
              <Sparkles className="w-3.5 h-3.5" />Re-check
            </Button>
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

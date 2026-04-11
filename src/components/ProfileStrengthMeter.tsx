import { useMemo } from 'react';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, AlertCircle, Shield } from 'lucide-react';

interface ProfileStrengthMeterProps {
  profile: any;
  skills: any[];
  employment: any[];
  education: any[];
  certifications: any[];
  proofPoints: any[];
}

interface FieldCheck {
  label: string;
  done: boolean;
  weight: number;
}

const ProfileStrengthMeter = ({ profile, skills, employment, education, certifications, proofPoints }: ProfileStrengthMeterProps) => {
  const { score, checks, missing } = useMemo(() => {
    const checks: FieldCheck[] = [
      { label: 'Full name', done: !!profile.full_name?.trim(), weight: 10 },
      { label: 'Headline', done: !!profile.headline?.trim(), weight: 8 },
      { label: 'Summary', done: !!profile.summary?.trim() && profile.summary.length > 20, weight: 10 },
      { label: 'Email', done: !!profile.email?.trim(), weight: 5 },
      { label: 'Location', done: !!profile.location?.trim(), weight: 5 },
      { label: 'Desired titles', done: (profile.desired_titles || []).length > 0, weight: 10 },
      { label: 'Salary range', done: profile.desired_salary_min > 0 || profile.desired_salary_max > 0, weight: 5 },
      { label: 'At least 3 skills', done: skills.length >= 3, weight: 12 },
      { label: 'At least 1 experience', done: employment.length >= 1, weight: 15 },
      { label: 'At least 1 education', done: education.length >= 1, weight: 10 },
      { label: 'At least 1 certification', done: certifications.length >= 1, weight: 5 },
      { label: 'At least 1 proof point', done: proofPoints.length >= 1, weight: 5 },
    ];

    const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
    const earnedWeight = checks.filter(c => c.done).reduce((s, c) => s + c.weight, 0);
    const score = Math.round((earnedWeight / totalWeight) * 100);
    const missing = checks.filter(c => !c.done);

    return { score, checks, missing };
  }, [profile, skills, employment, education, certifications, proofPoints]);

  const getColor = (s: number) => {
    if (s >= 80) return 'text-score-excellent';
    if (s >= 60) return 'text-score-good';
    if (s >= 40) return 'text-score-fair';
    return 'text-score-poor';
  };

  const getLabel = (s: number) => {
    if (s >= 90) return 'Excellent';
    if (s >= 70) return 'Strong';
    if (s >= 50) return 'Moderate';
    if (s >= 30) return 'Weak';
    return 'Incomplete';
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="w-4 h-4 text-muted-foreground" />
          Profile Strength
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <div className={`text-2xl font-bold ${getColor(score)}`}>{score}%</div>
          <div className="flex-1">
            <Progress value={score} className="h-2.5" />
          </div>
          <Badge variant={score >= 70 ? 'default' : 'secondary'} className="text-xs">
            {getLabel(score)}
          </Badge>
        </div>

        {missing.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Missing fields</p>
            {missing.slice(0, 5).map(m => (
              <div key={m.label} className="flex items-center gap-2 text-sm">
                <AlertCircle className="w-3.5 h-3.5 text-score-fair flex-shrink-0" />
                <span className="text-foreground">{m.label}</span>
              </div>
            ))}
            {missing.length > 5 && (
              <p className="text-xs text-muted-foreground">+{missing.length - 5} more</p>
            )}
          </div>
        )}

        {missing.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-score-excellent">
            <CheckCircle2 className="w-4 h-4" />
            <span>All profile sections complete!</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ProfileStrengthMeter;
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Plus, X, Save, Briefcase, GraduationCap, Award, Star } from 'lucide-react';
import EmptyState from '@/components/EmptyState';

interface ProfileData {
  full_name: string;
  headline: string;
  summary: string;
  location: string;
  country: string;
  visa_status: string;
  work_authorization: string;
  remote_preference: string;
  desired_salary_min: number;
  desired_salary_max: number;
  desired_salary_currency: string;
  desired_seniority: string;
  linkedin_url: string;
  github_url: string;
  portfolio_url: string;
  phone: string;
  email: string;
}

const Profile = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<ProfileData>({
    full_name: '', headline: '', summary: '', location: '', country: '',
    visa_status: '', work_authorization: '', remote_preference: 'flexible',
    desired_salary_min: 0, desired_salary_max: 0, desired_salary_currency: 'USD',
    desired_seniority: '', linkedin_url: '', github_url: '', portfolio_url: '',
    phone: '', email: '',
  });
  const [skills, setSkills] = useState<any[]>([]);
  const [newSkill, setNewSkill] = useState('');
  const [employment, setEmployment] = useState<any[]>([]);
  const [education, setEducation] = useState<any[]>([]);
  const [certifications, setCertifications] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const [profileRes, skillsRes, empRes, eduRes, certRes] = await Promise.all([
        supabase.from('profiles_v2').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('profile_skills').select('*').eq('user_id', user.id).order('is_primary', { ascending: false }),
        supabase.from('employment_history').select('*').eq('user_id', user.id).order('start_date', { ascending: false }),
        supabase.from('education_history').select('*').eq('user_id', user.id).order('start_date', { ascending: false }),
        supabase.from('certifications').select('*').eq('user_id', user.id).order('issue_date', { ascending: false }),
      ]);

      if (profileRes.data) {
        setProfile(profileRes.data as any);
      }
      setSkills(skillsRes.data ?? []);
      setEmployment(empRes.data ?? []);
      setEducation(eduRes.data ?? []);
      setCertifications(certRes.data ?? []);
      setLoading(false);
    };
    load();
  }, [user]);

  const saveProfile = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from('profiles_v2').upsert({
      user_id: user.id,
      ...profile,
    }, { onConflict: 'user_id' });

    if (error) {
      toast({ title: 'Error saving profile', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Profile saved' });
    }
    setSaving(false);
  };

  const addSkill = async () => {
    if (!user || !newSkill.trim()) return;
    const { data, error } = await supabase.from('profile_skills').insert({
      user_id: user.id,
      skill_name: newSkill.trim(),
    }).select().single();

    if (data) {
      setSkills([...skills, data]);
      setNewSkill('');
    }
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
  };

  const removeSkill = async (id: string) => {
    await supabase.from('profile_skills').delete().eq('id', id);
    setSkills(skills.filter(s => s.id !== id));
  };

  const updateField = (field: keyof ProfileData, value: string | number) => {
    setProfile(prev => ({ ...prev, [field]: value }));
  };

  if (loading) return <div className="animate-fade-in p-8 text-center text-muted-foreground">Loading profile...</div>;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Profile"
        description="Your canonical professional profile — the source of truth for all tailored documents"
        actions={
          <Button onClick={saveProfile} disabled={saving}>
            <Save className="w-4 h-4 mr-2" />{saving ? 'Saving...' : 'Save Profile'}
          </Button>
        }
      />

      <Tabs defaultValue="personal" className="space-y-4">
        <TabsList>
          <TabsTrigger value="personal">Personal</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="experience">Experience</TabsTrigger>
          <TabsTrigger value="education">Education</TabsTrigger>
          <TabsTrigger value="certifications">Certifications</TabsTrigger>
        </TabsList>

        <TabsContent value="personal" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Basic Information</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Full Name</Label>
                <Input value={profile.full_name} onChange={e => updateField('full_name', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Headline</Label>
                <Input value={profile.headline} onChange={e => updateField('headline', e.target.value)} placeholder="e.g. Senior Software Engineer" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Professional Summary</Label>
                <Textarea value={profile.summary} onChange={e => updateField('summary', e.target.value)} rows={4} />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={profile.email} onChange={e => updateField('email', e.target.value)} type="email" />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={profile.phone} onChange={e => updateField('phone', e.target.value)} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Location & Preferences</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Location</Label>
                <Input value={profile.location} onChange={e => updateField('location', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Country</Label>
                <Input value={profile.country} onChange={e => updateField('country', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Visa Status</Label>
                <Input value={profile.visa_status} onChange={e => updateField('visa_status', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Work Authorization</Label>
                <Input value={profile.work_authorization} onChange={e => updateField('work_authorization', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Desired Seniority</Label>
                <Input value={profile.desired_seniority} onChange={e => updateField('desired_seniority', e.target.value)} placeholder="e.g. Senior, Lead, Staff" />
              </div>
              <div className="space-y-2">
                <Label>Remote Preference</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={profile.remote_preference}
                  onChange={e => updateField('remote_preference', e.target.value)}
                >
                  <option value="remote">Remote</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="onsite">On-site</option>
                  <option value="flexible">Flexible</option>
                </select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Links</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>LinkedIn</Label>
                <Input value={profile.linkedin_url} onChange={e => updateField('linkedin_url', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>GitHub</Label>
                <Input value={profile.github_url} onChange={e => updateField('github_url', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Portfolio</Label>
                <Input value={profile.portfolio_url} onChange={e => updateField('portfolio_url', e.target.value)} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="skills">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Skills</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 mb-4">
                <Input
                  value={newSkill}
                  onChange={e => setNewSkill(e.target.value)}
                  placeholder="Add a skill..."
                  onKeyDown={e => e.key === 'Enter' && addSkill()}
                />
                <Button onClick={addSkill} size="sm"><Plus className="w-4 h-4" /></Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {skills.map(skill => (
                  <Badge key={skill.id} variant="secondary" className="gap-1 pr-1">
                    {skill.skill_name}
                    <button onClick={() => removeSkill(skill.id)} className="ml-1 hover:text-destructive">
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
                {skills.length === 0 && (
                  <p className="text-sm text-muted-foreground">No skills added yet.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="experience">
          <Card>
            <CardContent className="pt-6">
              {employment.length === 0 ? (
                <EmptyState
                  icon={Briefcase}
                  title="No experience added"
                  description="Add your work history to improve job matching accuracy."
                  actionLabel="Add Experience"
                  onAction={() => {/* TODO: modal */}}
                />
              ) : (
                <div className="space-y-4">
                  {employment.map(emp => (
                    <div key={emp.id} className="border border-border rounded-lg p-4">
                      <h3 className="font-semibold text-foreground">{emp.title}</h3>
                      <p className="text-sm text-muted-foreground">{emp.company} • {emp.location}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {emp.start_date} — {emp.is_current ? 'Present' : emp.end_date}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="education">
          <Card>
            <CardContent className="pt-6">
              {education.length === 0 ? (
                <EmptyState icon={GraduationCap} title="No education added" description="Add your educational background." />
              ) : (
                <div className="space-y-4">
                  {education.map(edu => (
                    <div key={edu.id} className="border border-border rounded-lg p-4">
                      <h3 className="font-semibold text-foreground">{edu.degree}</h3>
                      <p className="text-sm text-muted-foreground">{edu.institution}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="certifications">
          <Card>
            <CardContent className="pt-6">
              {certifications.length === 0 ? (
                <EmptyState icon={Award} title="No certifications added" description="Add your professional certifications." />
              ) : (
                <div className="space-y-4">
                  {certifications.map(cert => (
                    <div key={cert.id} className="border border-border rounded-lg p-4">
                      <h3 className="font-semibold text-foreground">{cert.name}</h3>
                      <p className="text-sm text-muted-foreground">{cert.issuing_organization}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Profile;

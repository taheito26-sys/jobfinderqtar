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
import { Plus, X, Save, Briefcase, GraduationCap, Award, Star, Pencil, Trash2, Zap } from 'lucide-react';
import EmptyState from '@/components/EmptyState';
import EmploymentModal from '@/components/EmploymentModal';
import EducationModal from '@/components/EducationModal';
import CertificationModal from '@/components/CertificationModal';
import ProofPointModal from '@/components/ProofPointModal';

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
  const [proofPoints, setProofPoints] = useState<any[]>([]);

  // Modal state
  const [empModal, setEmpModal] = useState<{ open: boolean; item?: any }>({ open: false });
  const [eduModal, setEduModal] = useState<{ open: boolean; item?: any }>({ open: false });
  const [certModal, setCertModal] = useState<{ open: boolean; item?: any }>({ open: false });
  const [proofModal, setProofModal] = useState<{ open: boolean; item?: any }>({ open: false });

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const [profileRes, skillsRes, empRes, eduRes, certRes, proofRes] = await Promise.all([
        supabase.from('profiles_v2').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('profile_skills').select('*').eq('user_id', user.id).order('is_primary', { ascending: false }),
        supabase.from('employment_history').select('*').eq('user_id', user.id).order('start_date', { ascending: false }),
        supabase.from('education_history').select('*').eq('user_id', user.id).order('start_date', { ascending: false }),
        supabase.from('certifications').select('*').eq('user_id', user.id).order('issue_date', { ascending: false }),
        supabase.from('proof_points').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      ]);
      if (profileRes.data) setProfile(profileRes.data as any);
      setSkills(skillsRes.data ?? []);
      setEmployment(empRes.data ?? []);
      setEducation(eduRes.data ?? []);
      setCertifications(certRes.data ?? []);
      setProofPoints(proofRes.data ?? []);
      setLoading(false);
    };
    load();
  }, [user]);

  const saveProfile = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from('profiles_v2').upsert({ user_id: user.id, ...profile }, { onConflict: 'user_id' });
    if (error) toast({ title: 'Error saving profile', description: error.message, variant: 'destructive' });
    else toast({ title: 'Profile saved' });
    setSaving(false);
  };

  const addSkill = async () => {
    if (!user || !newSkill.trim()) return;
    const { data, error } = await supabase.from('profile_skills').insert({ user_id: user.id, skill_name: newSkill.trim() }).select().single();
    if (data) { setSkills([...skills, data]); setNewSkill(''); }
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
  };

  const removeSkill = async (id: string) => {
    await supabase.from('profile_skills').delete().eq('id', id);
    setSkills(skills.filter(s => s.id !== id));
  };

  const deleteItem = async (table: 'employment_history' | 'education_history' | 'certifications' | 'proof_points', id: string, setter: Function, list: any[]) => {
    await supabase.from(table).delete().eq('id', id);
    setter(list.filter((i: any) => i.id !== id));
    toast({ title: 'Deleted' });
  };

  const updateField = (field: keyof ProfileData, value: string | number) => setProfile(prev => ({ ...prev, [field]: value }));

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
          <TabsTrigger value="experience">Experience ({employment.length})</TabsTrigger>
          <TabsTrigger value="education">Education ({education.length})</TabsTrigger>
          <TabsTrigger value="certifications">Certs ({certifications.length})</TabsTrigger>
          <TabsTrigger value="proofpoints">Proof Points ({proofPoints.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="personal" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Basic Information</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Full Name</Label><Input value={profile.full_name} onChange={e => updateField('full_name', e.target.value)} /></div>
              <div className="space-y-2"><Label>Headline</Label><Input value={profile.headline} onChange={e => updateField('headline', e.target.value)} placeholder="e.g. Senior Software Engineer" /></div>
              <div className="space-y-2 md:col-span-2"><Label>Professional Summary</Label><Textarea value={profile.summary} onChange={e => updateField('summary', e.target.value)} rows={4} /></div>
              <div className="space-y-2"><Label>Email</Label><Input value={profile.email} onChange={e => updateField('email', e.target.value)} type="email" /></div>
              <div className="space-y-2"><Label>Phone</Label><Input value={profile.phone} onChange={e => updateField('phone', e.target.value)} /></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Location & Preferences</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Location</Label><Input value={profile.location} onChange={e => updateField('location', e.target.value)} /></div>
              <div className="space-y-2"><Label>Country</Label><Input value={profile.country} onChange={e => updateField('country', e.target.value)} /></div>
              <div className="space-y-2"><Label>Visa Status</Label><Input value={profile.visa_status} onChange={e => updateField('visa_status', e.target.value)} /></div>
              <div className="space-y-2"><Label>Work Authorization</Label><Input value={profile.work_authorization} onChange={e => updateField('work_authorization', e.target.value)} /></div>
              <div className="space-y-2"><Label>Desired Seniority</Label><Input value={profile.desired_seniority} onChange={e => updateField('desired_seniority', e.target.value)} /></div>
              <div className="space-y-2">
                <Label>Remote Preference</Label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={profile.remote_preference} onChange={e => updateField('remote_preference', e.target.value)}>
                  <option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">On-site</option><option value="flexible">Flexible</option>
                </select>
              </div>
              <div className="space-y-2"><Label>Min Salary</Label><Input type="number" value={profile.desired_salary_min} onChange={e => updateField('desired_salary_min', Number(e.target.value))} /></div>
              <div className="space-y-2"><Label>Max Salary</Label><Input type="number" value={profile.desired_salary_max} onChange={e => updateField('desired_salary_max', Number(e.target.value))} /></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Links</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2"><Label>LinkedIn</Label><Input value={profile.linkedin_url} onChange={e => updateField('linkedin_url', e.target.value)} /></div>
              <div className="space-y-2"><Label>GitHub</Label><Input value={profile.github_url} onChange={e => updateField('github_url', e.target.value)} /></div>
              <div className="space-y-2"><Label>Portfolio</Label><Input value={profile.portfolio_url} onChange={e => updateField('portfolio_url', e.target.value)} /></div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="skills">
          <Card>
            <CardHeader><CardTitle className="text-base">Skills</CardTitle></CardHeader>
            <CardContent>
              <div className="flex gap-2 mb-4">
                <Input value={newSkill} onChange={e => setNewSkill(e.target.value)} placeholder="Add a skill..." onKeyDown={e => e.key === 'Enter' && addSkill()} />
                <Button onClick={addSkill} size="sm"><Plus className="w-4 h-4" /></Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {skills.map(skill => (
                  <Badge key={skill.id} variant="secondary" className="gap-1 pr-1">
                    {skill.skill_name}
                    <button onClick={() => removeSkill(skill.id)} className="ml-1 hover:text-destructive"><X className="w-3 h-3" /></button>
                  </Badge>
                ))}
                {skills.length === 0 && <p className="text-sm text-muted-foreground">No skills added yet.</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="experience">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Employment History</CardTitle>
              <Button size="sm" onClick={() => setEmpModal({ open: true })}><Plus className="w-4 h-4 mr-1" />Add</Button>
            </CardHeader>
            <CardContent>
              {employment.length === 0 ? (
                <EmptyState icon={Briefcase} title="No experience added" description="Add your work history to improve job matching." actionLabel="Add Experience" onAction={() => setEmpModal({ open: true })} />
              ) : (
                <div className="space-y-3">
                  {employment.map(emp => (
                    <div key={emp.id} className="border border-border rounded-lg p-4 group">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold text-foreground">{emp.title}</h3>
                          <p className="text-sm text-muted-foreground">{emp.company}{emp.location ? ` • ${emp.location}` : ''}</p>
                          <p className="text-xs text-muted-foreground mt-1">{emp.start_date} — {emp.is_current ? 'Present' : emp.end_date || 'N/A'}</p>
                          {emp.description && <p className="text-sm text-foreground mt-2">{emp.description}</p>}
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="sm" onClick={() => setEmpModal({ open: true, item: emp })}><Pencil className="w-3 h-3" /></Button>
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteItem('employment_history', emp.id, setEmployment, employment)}><Trash2 className="w-3 h-3" /></Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="education">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Education</CardTitle>
              <Button size="sm" onClick={() => setEduModal({ open: true })}><Plus className="w-4 h-4 mr-1" />Add</Button>
            </CardHeader>
            <CardContent>
              {education.length === 0 ? (
                <EmptyState icon={GraduationCap} title="No education added" description="Add your educational background." actionLabel="Add Education" onAction={() => setEduModal({ open: true })} />
              ) : (
                <div className="space-y-3">
                  {education.map(edu => (
                    <div key={edu.id} className="border border-border rounded-lg p-4 group">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold text-foreground">{edu.degree}</h3>
                          <p className="text-sm text-muted-foreground">{edu.institution}{edu.field_of_study ? ` — ${edu.field_of_study}` : ''}</p>
                          {(edu.start_date || edu.end_date) && <p className="text-xs text-muted-foreground mt-1">{edu.start_date || '?'} — {edu.end_date || '?'}</p>}
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="sm" onClick={() => setEduModal({ open: true, item: edu })}><Pencil className="w-3 h-3" /></Button>
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteItem('education_history', edu.id, setEducation, education)}><Trash2 className="w-3 h-3" /></Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="certifications">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Certifications</CardTitle>
              <Button size="sm" onClick={() => setCertModal({ open: true })}><Plus className="w-4 h-4 mr-1" />Add</Button>
            </CardHeader>
            <CardContent>
              {certifications.length === 0 ? (
                <EmptyState icon={Award} title="No certifications" description="Add your professional certifications." actionLabel="Add Certification" onAction={() => setCertModal({ open: true })} />
              ) : (
                <div className="space-y-3">
                  {certifications.map(cert => (
                    <div key={cert.id} className="border border-border rounded-lg p-4 group">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold text-foreground">{cert.name}</h3>
                          <p className="text-sm text-muted-foreground">{cert.issuing_organization}</p>
                          {cert.issue_date && <p className="text-xs text-muted-foreground mt-1">Issued: {cert.issue_date}{cert.expiry_date ? ` • Expires: ${cert.expiry_date}` : ''}</p>}
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="sm" onClick={() => setCertModal({ open: true, item: cert })}><Pencil className="w-3 h-3" /></Button>
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteItem('certifications', cert.id, setCertifications, certifications)}><Trash2 className="w-3 h-3" /></Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="proofpoints">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Proof Points</CardTitle>
              <Button size="sm" onClick={() => setProofModal({ open: true })}><Plus className="w-4 h-4 mr-1" />Add</Button>
            </CardHeader>
            <CardContent>
              {proofPoints.length === 0 ? (
                <EmptyState icon={Zap} title="No proof points" description="Add quantified achievements that can be reused across tailored documents." actionLabel="Add Proof Point" onAction={() => setProofModal({ open: true })} />
              ) : (
                <div className="space-y-3">
                  {proofPoints.map(pp => (
                    <div key={pp.id} className="border border-border rounded-lg p-4 group">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="text-xs capitalize">{pp.category}</Badge>
                            {pp.metric_value && <Badge variant="secondary" className="text-xs">{pp.metric_value}</Badge>}
                          </div>
                          <p className="text-sm text-foreground">{pp.statement}</p>
                          {pp.context && <p className="text-xs text-muted-foreground mt-1">{pp.context}</p>}
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="sm" onClick={() => setProofModal({ open: true, item: pp })}><Pencil className="w-3 h-3" /></Button>
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteItem('proof_points', pp.id, setProofPoints, proofPoints)}><Trash2 className="w-3 h-3" /></Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Modals */}
      {empModal.open && user && (
        <EmploymentModal
          open={empModal.open}
          onClose={() => setEmpModal({ open: false })}
          userId={user.id}
          editItem={empModal.item}
          onSaved={(item) => {
            if (empModal.item) {
              setEmployment(employment.map(e => e.id === item.id ? item : e));
            } else {
              setEmployment([item, ...employment]);
            }
          }}
        />
      )}
      {eduModal.open && user && (
        <EducationModal
          open={eduModal.open}
          onClose={() => setEduModal({ open: false })}
          userId={user.id}
          editItem={eduModal.item}
          onSaved={(item) => {
            if (eduModal.item) {
              setEducation(education.map(e => e.id === item.id ? item : e));
            } else {
              setEducation([item, ...education]);
            }
          }}
        />
      )}
      {certModal.open && user && (
        <CertificationModal
          open={certModal.open}
          onClose={() => setCertModal({ open: false })}
          userId={user.id}
          editItem={certModal.item}
          onSaved={(item) => {
            if (certModal.item) {
              setCertifications(certifications.map(c => c.id === item.id ? item : c));
            } else {
              setCertifications([item, ...certifications]);
            }
          }}
        />
      )}
      {proofModal.open && user && (
        <ProofPointModal
          open={proofModal.open}
          onClose={() => setProofModal({ open: false })}
          userId={user.id}
          employmentOptions={employment.map(e => ({ id: e.id, title: e.title, company: e.company }))}
          editItem={proofModal.item}
          onSaved={(item) => {
            if (proofModal.item) {
              setProofPoints(proofPoints.map(p => p.id === item.id ? item : p));
            } else {
              setProofPoints([item, ...proofPoints]);
            }
          }}
        />
      )}
    </div>
  );
};

export default Profile;

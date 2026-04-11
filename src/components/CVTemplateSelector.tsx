import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Palette, Loader2, Download, Columns2, AlignLeft, LayoutTemplate, FileText, File, Crown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Template {
  id: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
  features: string[];
}

const TEMPLATES: Template[] = [
  {
    id: 'classic',
    label: 'Classic',
    desc: 'Clean, traditional single-column layout. Best for conservative industries.',
    icon: <AlignLeft className="w-6 h-6" />,
    features: ['ATS-friendly', 'Single column', 'Serif headings'],
  },
  {
    id: 'modern',
    label: 'Modern',
    desc: 'Contemporary design with blue accents and double-line separators.',
    icon: <Columns2 className="w-6 h-6" />,
    features: ['Color accents', 'Bullet separators', 'Centered header'],
  },
  {
    id: 'executive',
    label: 'Executive',
    desc: 'Sophisticated serif layout for senior roles and leadership positions.',
    icon: <Crown className="w-6 h-6" />,
    features: ['Serif fonts', 'Title case', 'Wider margins'],
  },
  {
    id: 'minimal',
    label: 'Minimal',
    desc: 'Ultra-clean layout focused on content. Maximum ATS compatibility.',
    icon: <LayoutTemplate className="w-6 h-6" />,
    features: ['Max ATS score', 'No graphics', 'Clean spacing'],
  },
];

type ExportFormat = 'pdf' | 'docx';

interface CVTemplateSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: any;
  userId: string;
}

const CVTemplateSelector = ({ open, onOpenChange, document, userId }: CVTemplateSelectorProps) => {
  const { toast } = useToast();
  const [selected, setSelected] = useState('classic');
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    if (!document?.parsed_content) {
      toast({ title: 'No parsed content', description: 'Parse the CV first before generating a styled version.', variant: 'destructive' });
      return;
    }
    setGenerating(true);
    try {
      // Build the full URL to call the edge function directly with fetch
      // so we can get the binary response as a blob
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const session = (await supabase.auth.getSession()).data.session;
      
      const response = await fetch(`${supabaseUrl}/functions/v1/generate-document`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'apikey': supabaseKey,
        },
        body: JSON.stringify({
          document_id: document.id,
          template: selected,
          parsed_content: document.parsed_content,
          document_type: 'cv',
          format,
        }),
      });

      const contentType = response.headers.get('content-type') || '';
      
      if (contentType.includes('application/json')) {
        const json = await response.json();
        if (json.error) throw new Error(json.error);
        if (json.download_url) window.open(json.download_url, '_blank');
        toast({ title: 'CV generated!', description: `Your ${selected} styled CV is ready.` });
      } else {
        // Binary file response — trigger download
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = window.document.createElement('a');
        a.href = url;
        const ext = format === 'docx' ? 'docx' : 'pdf';
        a.download = `CV_${selected}.${ext}`;
        window.document.body.appendChild(a);
        a.click();
        window.document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast({ title: 'CV downloaded!', description: `Your ${selected} styled CV (${format.toUpperCase()}) has been downloaded.` });
      }

      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Generation failed', description: err.message, variant: 'destructive' });
    }
    setGenerating(false);
  };

  const parsed = document?.parsed_content;
  const hasContent = parsed && Object.keys(parsed).length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-primary" />
            Generate Styled Resume
          </DialogTitle>
        </DialogHeader>

        {/* Template Grid */}
        <div className="grid grid-cols-3 gap-3">
          {TEMPLATES.map(t => (
            <button
              key={t.id}
              onClick={() => setSelected(t.id)}
              className={`p-4 rounded-xl border-2 text-left transition-all group ${
                selected === t.id
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border hover:border-primary/40 hover:bg-muted/50'
              }`}
            >
              <div className={`w-full h-24 rounded-lg mb-3 flex items-center justify-center transition-colors ${
                selected === t.id ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground group-hover:text-foreground'
              }`}>
                {t.icon}
              </div>
              <p className="text-sm font-semibold">{t.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t.desc}</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {t.features.map(f => (
                  <Badge key={f} variant="outline" className="text-[10px] px-1.5 py-0">
                    {f}
                  </Badge>
                ))}
              </div>
            </button>
          ))}
        </div>

        {/* Format Toggle */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">Export format:</span>
          <div className="flex gap-1 bg-muted rounded-lg p-1">
            <button
              onClick={() => setFormat('pdf')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                format === 'pdf'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              PDF
            </button>
            <button
              onClick={() => setFormat('docx')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                format === 'docx'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <File className="w-3.5 h-3.5" />
              DOCX
            </button>
          </div>
          <span className="text-xs text-muted-foreground ml-auto">
            {format === 'pdf' ? 'Best for sharing & printing' : 'Editable in Word & Google Docs'}
          </span>
        </div>

        {/* Content Preview */}
        {hasContent && (
          <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
            <p className="text-xs font-medium text-foreground">Content to include:</p>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {parsed.full_name && <span>✓ {parsed.full_name}</span>}
              {parsed.headline && <span>✓ Headline</span>}
              {parsed.summary && <span>✓ Summary</span>}
              {Array.isArray(parsed.skills) && <span>✓ {parsed.skills.length} skills</span>}
              {Array.isArray(parsed.employment) && <span>✓ {parsed.employment.length} roles</span>}
              {Array.isArray(parsed.education) && <span>✓ {parsed.education.length} education</span>}
              {Array.isArray(parsed.certifications) && <span>✓ {parsed.certifications.length} certs</span>}
            </div>
          </div>
        )}

        {!hasContent && (
          <div className="bg-destructive/10 rounded-lg p-3 text-center">
            <p className="text-sm text-destructive">This document hasn't been parsed yet. Parse it first to generate a styled resume.</p>
          </div>
        )}

        {/* Generate Button */}
        <Button
          onClick={handleGenerate}
          disabled={generating || !hasContent}
          className="w-full gap-2"
          size="lg"
        >
          {generating ? (
            <><Loader2 className="w-4 h-4 animate-spin" />Generating {selected} {format.toUpperCase()}...</>
          ) : (
            <><Download className="w-4 h-4" />Download {TEMPLATES.find(t => t.id === selected)?.label} Resume ({format.toUpperCase()})</>
          )}
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default CVTemplateSelector;

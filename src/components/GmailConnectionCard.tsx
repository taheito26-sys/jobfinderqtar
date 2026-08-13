import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Mail, Loader2, CheckCircle2, RefreshCw, Unplug } from 'lucide-react';

interface GmailConnection {
  email_address: string;
  last_scanned_at: string | null;
  last_scan_status: 'pending' | 'ok' | 'error';
  last_scan_message: string;
  jobs_imported: number;
  connected_at: string;
}

/** Google redirects back here after consent; the code is exchanged server-side. */
const REDIRECT_PATH = '/settings';

const GmailConnectionCard = () => {
  const { toast } = useToast();
  const [connection, setConnection] = useState<GmailConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [scanning, setScanning] = useState(false);

  const redirectUri = `${window.location.origin}${REDIRECT_PATH}`;

  const loadStatus = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke('gmail-oauth', {
      body: { action: 'status' },
    });
    if (!error && data?.success) setConnection(data.connection);
    setLoading(false);
  }, []);

  // Complete the OAuth handshake when Google redirects back with ?code=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const oauthError = params.get('error');

    if (oauthError) {
      toast({
        title: 'Gmail connection cancelled',
        description: oauthError === 'access_denied'
          ? 'You declined the permission request.'
          : oauthError,
        variant: 'destructive',
      });
      window.history.replaceState({}, '', REDIRECT_PATH);
      return;
    }

    if (!code) {
      void loadStatus();
      return;
    }

    setConnecting(true);
    // Clear the code from the URL immediately so a refresh cannot replay it.
    window.history.replaceState({}, '', REDIRECT_PATH);

    void (async () => {
      const { data, error } = await supabase.functions.invoke('gmail-oauth', {
        body: { action: 'callback', code, redirectUri },
      });

      if (error || data?.error) {
        toast({
          title: 'Could not connect Gmail',
          description: data?.detail || data?.error || error?.message || 'Unknown error',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Gmail connected',
          description: `Scanning job alerts sent to ${data.email_address}.`,
        });
      }
      setConnecting(false);
      void loadStatus();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    const { data, error } = await supabase.functions.invoke('gmail-oauth', {
      body: { action: 'authorize', redirectUri },
    });

    if (error || data?.error) {
      toast({
        title: 'Gmail is not set up yet',
        description: data?.detail || data?.error || error?.message,
        variant: 'destructive',
      });
      setConnecting(false);
      return;
    }
    window.location.href = data.url;
  };

  const handleScan = async () => {
    setScanning(true);
    const { data, error } = await supabase.functions.invoke('gmail-scan-jobs', {
      body: { days: 14, limit: 25 },
    });
    setScanning(false);

    if (error || data?.error) {
      toast({
        title: 'Scan failed',
        description: data?.detail || data?.error || error?.message,
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: `Imported ${data.jobs_imported} job${data.jobs_imported === 1 ? '' : 's'}`,
      description:
        `Scanned ${data.messages_scanned} email(s) · ${data.jobs_found} found · ` +
        `${data.jobs_skipped} already tracked`,
    });
    void loadStatus();
  };

  const handleDisconnect = async () => {
    await supabase.functions.invoke('gmail-oauth', { body: { action: 'disconnect' } });
    setConnection(null);
    toast({
      title: 'Gmail disconnected',
      description: 'Access was revoked at Google. Imported jobs were kept.',
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Mail className="w-4 h-4" />
          Gmail Job Alerts
          {connection && (
            <Badge variant="secondary" className="ml-1 gap-1">
              <CheckCircle2 className="w-3 h-3" />
              Connected
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Scan job-alert emails from NaukriGulf, LinkedIn, Bayt and GulfTalent and import
          the roles they list. Read-only access — nothing is sent, changed or deleted.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking connection…
          </div>
        ) : connection ? (
          <>
            <div className="text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Account</span>
                <span className="font-medium">{connection.email_address || 'Gmail'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last scan</span>
                <span>
                  {connection.last_scanned_at
                    ? new Date(connection.last_scanned_at).toLocaleString()
                    : 'Never'}
                </span>
              </div>
              {connection.last_scan_message && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Result</span>
                  <span
                    className={
                      connection.last_scan_status === 'error'
                        ? 'text-destructive text-right'
                        : 'text-right'
                    }
                  >
                    {connection.last_scan_message}
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button onClick={handleScan} disabled={scanning} size="sm">
                {scanning ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Scanning…</>
                ) : (
                  <><RefreshCw className="w-4 h-4 mr-2" />Scan now</>
                )}
              </Button>
              <Button onClick={handleDisconnect} variant="outline" size="sm">
                <Unplug className="w-4 h-4 mr-2" />
                Disconnect
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Connect Gmail to pull jobs out of the alert digests you already receive.
              Regional roles outside Qatar are imported but flagged, so Qatar jobs still
              rank first.
            </p>
            <Button onClick={handleConnect} disabled={connecting} size="sm">
              {connecting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Connecting…</>
              ) : (
                <><Mail className="w-4 h-4 mr-2" />Connect Gmail</>
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default GmailConnectionCard;

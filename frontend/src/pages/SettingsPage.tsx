import { Mail, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardFooter, CardHeader } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { SlackCard } from '../components/dashboard/SlackCard';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const TIMEZONES = [
  { label: 'Asia/Kolkata (GMT+5:30)', value: 'Asia/Kolkata' },
  { label: 'Europe/London (GMT+0)', value: 'Europe/London' },
  { label: 'America/New_York (GMT-5)', value: 'America/New_York' },
  { label: 'America/Los_Angeles (GMT-8)', value: 'America/Los_Angeles' },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();

  const [name, setName] = useState(user?.name ?? '');
  const [email] = useState(user?.email ?? '');
  const [timezone, setTimezone] = useState('Asia/Kolkata');

  const integrations = [
    {
      id: 'google',
      name: 'Google Workspace',
      description: 'Sign in and send from your Google account.',
      icon: Mail,
      connected: false,
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <CardHeader title="Profile" description="How your account appears across ReachInbox." />
        <CardBody className="space-y-5">
          <div className="flex items-center gap-4">
            <Avatar name={name || 'User'} src={user?.avatar ?? undefined} size="lg" />
            <div>
              <p className="text-sm font-medium text-slate-900">{name || 'Unnamed user'}</p>
              <p className="text-xs text-slate-500">PNG or JPG, up to 2 MB.</p>
            </div>
            <Button variant="outline" size="sm" className="ml-auto" disabled>
              Change
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id="settings-name"
              label="Full name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Input
              id="settings-email"
              label="Email"
              type="email"
              value={email}
              readOnly
              hint="Managed by your identity provider."
            />
            <Select
              id="settings-timezone"
              label="Timezone"
              containerClassName="sm:col-span-2"
              options={TIMEZONES}
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              hint="Scheduled send times are shown in this timezone."
            />
          </div>
        </CardBody>
        <CardFooter>
          <Button variant="outline">Cancel</Button>
          <Button
            onClick={() =>
              toast.toast({
                variant: 'info',
                title: 'Not editable yet',
                description: 'Your name and email come from your Google account.',
              })
            }
          >
            Save changes
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader title="Integrations" description="Connect the tools your team already uses." />
        <div className="px-5 pt-5">
          <SlackCard outcome={params.get('slack')} />
        </div>
        <ul className="divide-y divide-slate-200">
          {integrations.map((integration) => (
            <li key={integration.id} className="flex items-center gap-4 px-5 py-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                <integration.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">{integration.name}</p>
                <p className="text-xs text-slate-500">{integration.description}</p>
              </div>
              <Badge tone={integration.connected ? 'success' : 'neutral'}>
                {integration.connected ? 'Connected' : 'Not connected'}
              </Badge>
              <Button variant="outline" size="sm" disabled>
                Connect
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Sending limits" description="Guard rails applied to every campaign." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Input id="settings-hourly" label="Default hourly limit" type="number" defaultValue={100} min={1} />
          <Input id="settings-daily" label="Default daily limit" type="number" defaultValue={1000} min={1} />
          <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600 sm:col-span-2">
            <ShieldCheck className="mt-px h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            Limits protect your sender reputation. They are enforced by the queue once the backend
            is connected.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

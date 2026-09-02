import { useEffect, useRef, useState } from 'react';
import type { TraderConfig } from '@shared/types';
import { useToast } from '../state/ToastProvider';
import { Card, Page, Section, Switch } from '../components/common';
import { useConfigQuery, usePatchConfigMutation } from '../hooks/useConfig';

export function SettingsPage() {
  const { data: config } = useConfigQuery();
  const patchConfig = usePatchConfigMutation();
  const toast = useToast();

  if (!config) return <Page title="Settings"><div className="text-pocketed-muted">Loading…</div></Page>;

  const update = async <K extends keyof TraderConfig>(key: K, value: TraderConfig[K]): Promise<void> => {
    try {
      await patchConfig.mutateAsync({ [key]: value } as Partial<TraderConfig>);
    } catch (e: any) {
      toast.error(`${e?.message || e}`);
    }
  };

  return (
    <Page
      title="Settings"
      subtitle="App-level preferences: startup behavior, notifications, and data. Each trading engine has its own page and its own on/off switch — Main Engine (whales + momentum), Crypto, Copy Trading, and Scripts."
    >
      <Section
        title="Discord webhooks (optional)"
        description="Drop your channel webhook URLs to mirror events to Discord."
      >
        <Card>
          <div className="grid gap-3 md:grid-cols-2">
            <UrlField label="Trade events" value={config.eventWebhookUrl}
              onChange={(v) => void update('eventWebhookUrl', v)} />
            <UrlField label="Stats" value={config.statsWebhookUrl}
              onChange={(v) => void update('statsWebhookUrl', v)} />
            <UrlField label="Whale alerts" value={config.whaleWebhookUrl}
              onChange={(v) => void update('whaleWebhookUrl', v)} />
            <UrlField label="Momentum alerts" value={config.momentumWebhookUrl}
              onChange={(v) => void update('momentumWebhookUrl', v)} />
          </div>
          <Switch
            label="Enable Discord webhooks"
            description="Master switch — turn off to mute all webhook posting without losing the URLs."
            checked={config.enableDiscord}
            onChange={(v) => void update('enableDiscord', v)}
          />
        </Card>
      </Section>
    </Page>
  );
}

function UrlField({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(value); }, [value]);
  return (
    <div>
      <label className="pocketed-label">{label} webhook</label>
      <input
        type="text"
        className="pocketed-input font-mono text-xs"
        value={text}
        placeholder="https://discord.com/api/webhooks/…"
        onFocus={() => { focused.current = true; }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { focused.current = false; if (text !== value) onChange(text); }}
      />
    </div>
  );
}

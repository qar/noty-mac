import { BellRing, Bot, Info, Radio, type LucideIcon } from 'lucide-react';

export type SettingsTab = 'general' | 'channels' | 'integration' | 'about';

export const SETTINGS_TABS: readonly {
  id: SettingsTab;
  label: string;
  icon: LucideIcon;
}[] = [
  { id: 'general', label: '常规', icon: BellRing },
  { id: 'channels', label: '频道', icon: Radio },
  { id: 'integration', label: 'AI 集成', icon: Bot },
  { id: 'about', label: '关于', icon: Info },
];

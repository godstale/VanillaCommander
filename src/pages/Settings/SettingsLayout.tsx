import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ArrowLeft, Sliders, Cpu, ShieldCheck, Plug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const NAV_ITEMS = [
  { path: '/settings', labelKey: 'settings.navGeneral', icon: Sliders, end: true },
  { path: '/settings/model', labelKey: 'settings.navModel', icon: Cpu, end: false },
  { path: '/settings/approval', labelKey: 'settings.navApproval', icon: ShieldCheck, end: false },
  { path: '/settings/integrations', labelKey: 'eval.integrations.navTitle', icon: Plug, end: false },
];

export function SettingsLayout() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  return (
    <div className="flex h-screen w-screen bg-background text-foreground overflow-hidden">
      {/* Settings Left Navigation Sidebar */}
      <div className="w-64 border-r border-border bg-card/40 flex flex-col justify-between p-4 shrink-0">
        <div>
          <div className="flex items-center gap-2 mb-6">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => navigate('/')}
              title={t('settings.back')}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-base font-bold tracking-tight">{t('settings.title')}</h1>
          </div>

          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map(({ path, labelKey, icon: Icon, end }) => (
              <NavLink
                key={path}
                to={path}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                  )
                }
              >
                <Icon className="h-4 w-4" />
                <span>{t(labelKey)}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="text-[11px] text-muted-foreground p-2 border-t border-border">
          <p className="font-semibold text-foreground">Fortress v0.1.0</p>
          <p className="opacity-70 mt-0.5">{t('settings.footer')}</p>
        </div>
      </div>

      {/* Main Settings Content Form Area */}
      <div className="flex-1 overflow-y-auto p-8 max-w-3xl">
        <Outlet />
      </div>
    </div>
  );
}

export default SettingsLayout;

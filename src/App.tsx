import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Workspace from '@/pages/Workspace';
import SettingsLayout from '@/pages/Settings/SettingsLayout';
import SettingsGeneral from '@/pages/Settings/SettingsGeneral';
import SettingsModel from '@/pages/Settings/SettingsModel';
import SettingsApproval from '@/pages/Settings/SettingsApproval';
import SettingsIntegrations from '@/pages/Settings/SettingsIntegrations';

import { ThemeProvider } from '@/lib/context/ThemeContext';
import { SettingsProvider } from '@/lib/context/SettingsContext';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { LanguageSelectDialog } from '@/components/language/LanguageSelectDialog';

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <SettingsProvider>
          <HashRouter>
            <Routes>
              <Route path="/" element={<Workspace />} />
              <Route path="/settings" element={<SettingsLayout />}>
                <Route index element={<SettingsGeneral />} />
                <Route path="general" element={<SettingsGeneral />} />
                <Route path="model" element={<SettingsModel />} />
                <Route path="approval" element={<SettingsApproval />} />
                <Route path="integrations" element={<SettingsIntegrations />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            <LanguageSelectDialog />
          </HashRouter>
        </SettingsProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

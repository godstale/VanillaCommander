import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Workspace from '@/pages/Workspace';
import SettingsLayout from '@/pages/Settings/SettingsLayout';
import SettingsGeneral from '@/pages/Settings/SettingsGeneral';
import SettingsModel from '@/pages/Settings/SettingsModel';
import SettingsApproval from '@/pages/Settings/SettingsApproval';
import SettingsIntegrations from '@/pages/Settings/SettingsIntegrations';
import SettingsParsers from '@/pages/Settings/SettingsParsers';

import { ThemeProvider } from '@/lib/context/ThemeContext';
import { SettingsProvider } from '@/lib/context/SettingsContext';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

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
                {/* P11-34: 파서 화면. P11-50 설정 재구성에서 라우트 정리 예정. */}
                <Route path="parsers" element={<SettingsParsers />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </HashRouter>
        </SettingsProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

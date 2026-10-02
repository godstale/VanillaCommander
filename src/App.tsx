import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Workspace from '@/pages/Workspace';
import SettingsLayout from '@/pages/Settings/SettingsLayout';
import SettingsGeneral from '@/pages/Settings/SettingsGeneral';
import SettingsParsers from '@/pages/Settings/SettingsParsers';
import SettingsUpdate from '@/pages/Settings/SettingsUpdate';

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
                <Route path="parsers" element={<SettingsParsers />} />
                <Route path="update" element={<SettingsUpdate />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </HashRouter>
        </SettingsProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

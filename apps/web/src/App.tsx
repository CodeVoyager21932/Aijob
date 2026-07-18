import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { shouldEnableLocalSurfaces } from "./environment";
import { InternalPreviewJobDetailPage } from "./pages/InternalPreviewJobDetailPage";
import { InternalPreviewJobListPage } from "./pages/InternalPreviewJobListPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProductUnavailablePage } from "./pages/ProductUnavailablePage";
import { ResearchJobDetailPage } from "./research/ResearchJobDetailPage";
import { ResearchJobListPage } from "./research/ResearchJobListPage";
import { ResearchShell } from "./research/ResearchShell";

export function App() {
  const localSurfacesEnabled = shouldEnableLocalSurfaces({
    isDev: import.meta.env.DEV,
    mode: import.meta.env.MODE,
  });

  if (!localSurfacesEnabled) {
    return (
      <Routes>
        <Route path="*" element={<ProductUnavailablePage />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/research/jobs" replace />} />
      <Route path="/research" element={<ResearchShell />}>
        <Route index element={<Navigate to="/research/jobs" replace />} />
        <Route path="jobs" element={<ResearchJobListPage />} />
        <Route path="jobs/:jobId" element={<ResearchJobDetailPage />} />
      </Route>
      <Route
        path="/internal-preview/jobs"
        element={
          <AppShell>
            <InternalPreviewJobListPage />
          </AppShell>
        }
      />
      <Route
        path="/internal-preview/jobs/:jobId"
        element={
          <AppShell>
            <InternalPreviewJobDetailPage />
          </AppShell>
        }
      />
      <Route
        path="*"
        element={
          <AppShell>
            <NotFoundPage />
          </AppShell>
        }
      />
    </Routes>
  );
}

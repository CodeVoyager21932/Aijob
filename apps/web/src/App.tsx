import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { InternalPreviewJobDetailPage } from "./pages/InternalPreviewJobDetailPage";
import { InternalPreviewJobListPage } from "./pages/InternalPreviewJobListPage";
import { NotFoundPage } from "./pages/NotFoundPage";

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/internal-preview/jobs" replace />} />
        <Route path="/internal-preview/jobs" element={<InternalPreviewJobListPage />} />
        <Route path="/internal-preview/jobs/:jobId" element={<InternalPreviewJobDetailPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppShell>
  );
}

import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { ProductShell } from "./components/ProductShell";
import { shouldEnableLocalSurfaces } from "./environment";
import { DataControlPage } from "./pages/DataControlPage";
import { DeletionStatusPage } from "./pages/DeletionStatusPage";
import { InternalPreviewJobDetailPage } from "./pages/InternalPreviewJobDetailPage";
import { InternalPreviewJobListPage } from "./pages/InternalPreviewJobListPage";
import { JobDetailPage } from "./pages/JobDetailPage";
import { JobListPage } from "./pages/JobListPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProductUnavailablePage } from "./pages/ProductUnavailablePage";
import { RecommendationsPage } from "./pages/RecommendationsPage";
import { ResumeConfirmPage } from "./pages/ResumeConfirmPage";
import { ResumePage } from "./pages/ResumePage";
import { ResumeTailoringPage } from "./pages/ResumeTailoringPage";
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
      <Route path="/" element={<Navigate to="/jobs" replace />} />
      <Route element={<ProductShell />}>
        <Route path="/jobs" element={<JobListPage />} />
        <Route path="/jobs/:jobId" element={<JobDetailPage />} />
        <Route path="/resume" element={<ResumePage />} />
        <Route path="/resume/confirm/:analysisId" element={<ResumeConfirmPage />} />
        <Route path="/recommendations" element={<RecommendationsPage />} />
        <Route path="/resume-tailorings/:runId" element={<ResumeTailoringPage />} />
        <Route path="/data-control" element={<DataControlPage />} />
        <Route path="/data-control/deletion" element={<DeletionStatusPage />} />
      </Route>
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
          <ProductShell>
            <NotFoundPage />
          </ProductShell>
        }
      />
    </Routes>
  );
}

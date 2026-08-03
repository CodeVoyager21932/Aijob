import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { AlphaAccessGate } from "./components/AlphaAccessGate";
import { ProductShell } from "./components/ProductShell";
import {
  shouldEnableInternalSurfaces,
  shouldEnableProductSurfaces,
  shouldRequireAlphaAccess,
} from "./environment";
import { DataControlPage } from "./pages/DataControlPage";
import { DeletionStatusPage } from "./pages/DeletionStatusPage";
import { InternalPreviewJobDetailPage } from "./pages/InternalPreviewJobDetailPage";
import { InternalPreviewJobListPage } from "./pages/InternalPreviewJobListPage";
import { JobDetailPage } from "./pages/JobDetailPage";
import { JobInsightsPage } from "./pages/JobInsightsPage";
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
  const environment = {
    isDev: import.meta.env.DEV,
    mode: import.meta.env.MODE,
  };
  const productSurfacesEnabled = shouldEnableProductSurfaces(environment);
  const internalSurfacesEnabled = shouldEnableInternalSurfaces(environment);
  const alphaAccessRequired = shouldRequireAlphaAccess(environment);

  if (!productSurfacesEnabled) {
    return (
      <Routes>
        <Route path="*" element={<ProductUnavailablePage />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/jobs" replace />} />
      <Route
        element={
          <AlphaAccessGate enabled={alphaAccessRequired}>
            <ProductShell />
          </AlphaAccessGate>
        }
      >
        <Route path="/jobs" element={<JobListPage />} />
        <Route path="/jobs/:jobId" element={<JobDetailPage />} />
        <Route path="/insights" element={<JobInsightsPage />} />
        <Route path="/resume" element={<ResumePage />} />
        <Route path="/resume/confirm/:analysisId" element={<ResumeConfirmPage />} />
        <Route path="/recommendations" element={<RecommendationsPage />} />
        <Route path="/resume-tailorings/:runId" element={<ResumeTailoringPage />} />
        <Route path="/data-control" element={<DataControlPage />} />
        <Route path="/data-control/deletion" element={<DeletionStatusPage />} />
      </Route>
      {internalSurfacesEnabled ? (
        <Route path="/research" element={<ResearchShell />}>
          <Route index element={<Navigate to="/research/jobs" replace />} />
          <Route path="jobs" element={<ResearchJobListPage />} />
          <Route path="jobs/:jobId" element={<ResearchJobDetailPage />} />
        </Route>
      ) : null}
      {internalSurfacesEnabled ? (
        <Route
          path="/internal-preview/jobs"
          element={
            <AppShell>
              <InternalPreviewJobListPage />
            </AppShell>
          }
        />
      ) : null}
      {internalSurfacesEnabled ? (
        <Route
          path="/internal-preview/jobs/:jobId"
          element={
            <AppShell>
              <InternalPreviewJobDetailPage />
            </AppShell>
          }
        />
      ) : null}
      <Route
        path="*"
        element={
          <AlphaAccessGate enabled={alphaAccessRequired}>
            <ProductShell>
              <NotFoundPage />
            </ProductShell>
          </AlphaAccessGate>
        }
      />
    </Routes>
  );
}

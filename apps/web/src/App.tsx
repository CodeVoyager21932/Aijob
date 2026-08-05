import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AlphaAccessGate } from "./components/AlphaAccessGate";
import { AppShell } from "./components/AppShell";
import { ProductShell } from "./components/ProductShell";
import {
  shouldEnableCareerOsV2,
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

const WorkspaceShell = lazy(() =>
  import("./career-os/WorkspaceShell").then((module) => ({ default: module.WorkspaceShell })),
);
const ApplicationsPage = lazy(() =>
  import("./career-os/pages/ApplicationsPage").then((module) => ({
    default: module.ApplicationsPage,
  })),
);
const CaseWorkspacePage = lazy(() =>
  import("./career-os/pages/CaseWorkspacePage").then((module) => ({
    default: module.CaseWorkspacePage,
  })),
);
const CareerOsHomePage = lazy(() =>
  import("./career-os/pages/CareerOsHomePage").then((module) => ({
    default: module.CareerOsHomePage,
  })),
);
const CareerOsPlaceholderPage = lazy(() =>
  import("./career-os/pages/CareerOsPlaceholderPage").then((module) => ({
    default: module.CareerOsPlaceholderPage,
  })),
);

export function App() {
  const environment = {
    isDev: import.meta.env.DEV,
    mode: import.meta.env.MODE,
  };
  const productSurfacesEnabled = shouldEnableProductSurfaces(environment);
  const internalSurfacesEnabled = shouldEnableInternalSurfaces(environment);
  const alphaAccessRequired = shouldRequireAlphaAccess(environment);
  const careerOsV2Enabled = shouldEnableCareerOsV2({
    flag: import.meta.env.VITE_CAREER_OS_V2,
  });

  if (!productSurfacesEnabled) {
    return (
      <Routes>
        <Route path="*" element={<ProductUnavailablePage />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to={careerOsV2Enabled ? "/today" : "/jobs"} replace />} />
      <Route
        element={
          <AlphaAccessGate enabled={alphaAccessRequired}>
            {careerOsV2Enabled ? (
              <Suspense fallback={<div className="route-loading">正在打开求职工作台…</div>}>
                <WorkspaceShell />
              </Suspense>
            ) : (
              <ProductShell />
            )}
          </AlphaAccessGate>
        }
      >
        {careerOsV2Enabled ? (
          <>
            <Route path="/today" element={<CareerOsHomePage />} />
            <Route path="/applications" element={<ApplicationsPage />} />
            <Route path="/applications/:caseId" element={<Navigate to="overview" replace />} />
            <Route path="/applications/:caseId/:tab" element={<CaseWorkspacePage />} />
            <Route path="/resumes" element={<CareerOsPlaceholderPage surface="resumes" />} />
            <Route path="/interviews" element={<CareerOsPlaceholderPage surface="interviews" />} />
            <Route path="/knowledge" element={<CareerOsPlaceholderPage surface="knowledge" />} />
            <Route path="/settings/data" element={<DataControlPage />} />
          </>
        ) : null}
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

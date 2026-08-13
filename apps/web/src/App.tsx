import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { legacySurfaceMode } from "./career-os/legacy-compatibility";
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
const ResumeAssetsPage = lazy(() =>
  import("./career-os/pages/ResumeAssetsPage").then((module) => ({
    default: module.ResumeAssetsPage,
  })),
);
const CareerDataControlPage = lazy(() =>
  import("./career-os/pages/CareerDataControlPage").then((module) => ({
    default: module.CareerDataControlPage,
  })),
);
const LegacyCompatibilityPage = lazy(() =>
  import("./career-os/pages/LegacyCompatibilityPage").then((module) => ({
    default: module.LegacyCompatibilityPage,
  })),
);
const WorkspaceNotFoundPage = lazy(() =>
  import("./career-os/pages/WorkspaceNotFoundPage").then((module) => ({
    default: module.WorkspaceNotFoundPage,
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
  const recommendationMode = legacySurfaceMode(careerOsV2Enabled, "recommendations");
  const insightMode = legacySurfaceMode(careerOsV2Enabled, "insights");
  const tailoringMode = legacySurfaceMode(careerOsV2Enabled, "resume_tailoring");
  const dataControlMode = legacySurfaceMode(careerOsV2Enabled, "data_control");

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
          careerOsV2Enabled ? (
            <Suspense fallback={<div className="route-loading">正在打开求职工作台…</div>}>
              <WorkspaceShell accessRequired={alphaAccessRequired} />
            </Suspense>
          ) : (
            <AlphaAccessGate enabled={alphaAccessRequired}>
              <ProductShell />
            </AlphaAccessGate>
          )
        }
      >
        {careerOsV2Enabled ? (
          <>
            <Route path="/today" element={<CareerOsHomePage />} />
            <Route path="/applications" element={<ApplicationsPage />} />
            <Route path="/applications/:caseId" element={<Navigate to="overview" replace />} />
            <Route path="/applications/:caseId/:tab" element={<CaseWorkspacePage />} />
            <Route path="/resumes" element={<ResumeAssetsPage />} />
            <Route path="/resumes/:documentId" element={<ResumeAssetsPage />} />
            <Route path="/settings/data" element={<CareerDataControlPage />} />
            <Route path="/settings/data/deletion" element={<DeletionStatusPage />} />
            <Route path="*" element={<WorkspaceNotFoundPage />} />
          </>
        ) : null}
        <Route path="/jobs" element={<JobListPage />} />
        <Route path="/jobs/:jobId" element={<JobDetailPage />} />
        <Route
          path="/insights"
          element={
            insightMode === "compatibility" ? (
              <LegacyCompatibilityPage surface="insights" />
            ) : (
              <JobInsightsPage />
            )
          }
        />
        <Route path="/resume" element={<ResumePage />} />
        <Route path="/resume/confirm/:analysisId" element={<ResumeConfirmPage />} />
        <Route
          path="/recommendations"
          element={
            recommendationMode === "compatibility" ? (
              <LegacyCompatibilityPage surface="recommendations" />
            ) : (
              <RecommendationsPage />
            )
          }
        />
        <Route
          path="/resume-tailorings/:runId"
          element={<ResumeTailoringPage readOnly={tailoringMode === "read_only"} />}
        />
        <Route
          path="/data-control"
          element={
            dataControlMode === "redirect" ? (
              <Navigate to="/settings/data" replace />
            ) : (
              <DataControlPage />
            )
          }
        />
        <Route
          path="/data-control/deletion"
          element={
            dataControlMode === "redirect" ? (
              <Navigate to="/settings/data/deletion" replace />
            ) : (
              <DeletionStatusPage />
            )
          }
        />
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

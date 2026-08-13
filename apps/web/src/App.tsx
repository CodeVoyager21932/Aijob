import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { AlphaAccessGate } from "./components/AlphaAccessGate";
import { AppShell } from "./components/AppShell";
import { ProductShell } from "./components/ProductShell";
import {
  shouldEnableCareerOsV2,
  shouldEnableInternalSurfaces,
  shouldEnableProductSurfaces,
  shouldRequireAlphaAccess,
} from "./environment";
import { ResearchShell } from "./research/ResearchShell";

const WorkspaceShell = lazy(() =>
  import("./career-os/WorkspaceShell").then((module) => ({ default: module.WorkspaceShell })),
);
const ApplicationsPage = lazy(() =>
  import("./career-os/pages/ApplicationsPage").then((module) => ({
    default: module.ApplicationsPage,
  })),
);
const CareerDataControlPage = lazy(() =>
  import("./career-os/pages/CareerDataControlPage").then((module) => ({
    default: module.CareerDataControlPage,
  })),
);
const CareerOsHomePage = lazy(() =>
  import("./career-os/pages/CareerOsHomePage").then((module) => ({
    default: module.CareerOsHomePage,
  })),
);
const CaseWorkspacePage = lazy(() =>
  import("./career-os/pages/CaseWorkspacePage").then((module) => ({
    default: module.CaseWorkspacePage,
  })),
);
const JobDiscoveryPage = lazy(() =>
  import("./career-os/pages/JobDiscoveryPage").then((module) => ({
    default: module.JobDiscoveryPage,
  })),
);
const JobInsightsWorkspacePage = lazy(() =>
  import("./career-os/pages/JobInsightsWorkspacePage").then((module) => ({
    default: module.JobInsightsWorkspacePage,
  })),
);
const JobRecommendationsPage = lazy(() =>
  import("./career-os/pages/JobRecommendationsPage").then((module) => ({
    default: module.JobRecommendationsPage,
  })),
);
const JobWorkspacePage = lazy(() =>
  import("./career-os/pages/JobWorkspacePage").then((module) => ({
    default: module.JobWorkspacePage,
  })),
);
const ResumeAssetsPage = lazy(() =>
  import("./career-os/pages/ResumeAssetsPage").then((module) => ({
    default: module.ResumeAssetsPage,
  })),
);
const WorkspaceNotFoundPage = lazy(() =>
  import("./career-os/pages/WorkspaceNotFoundPage").then((module) => ({
    default: module.WorkspaceNotFoundPage,
  })),
);

const DataControlPage = lazy(() =>
  import("./pages/DataControlPage").then((module) => ({ default: module.DataControlPage })),
);
const DeletionStatusPage = lazy(() =>
  import("./pages/DeletionStatusPage").then((module) => ({
    default: module.DeletionStatusPage,
  })),
);
const InternalPreviewJobDetailPage = lazy(() =>
  import("./pages/InternalPreviewJobDetailPage").then((module) => ({
    default: module.InternalPreviewJobDetailPage,
  })),
);
const InternalPreviewJobListPage = lazy(() =>
  import("./pages/InternalPreviewJobListPage").then((module) => ({
    default: module.InternalPreviewJobListPage,
  })),
);
const JobDetailPage = lazy(() =>
  import("./pages/JobDetailPage").then((module) => ({ default: module.JobDetailPage })),
);
const JobInsightsPage = lazy(() =>
  import("./pages/JobInsightsPage").then((module) => ({ default: module.JobInsightsPage })),
);
const JobListPage = lazy(() =>
  import("./pages/JobListPage").then((module) => ({ default: module.JobListPage })),
);
const NotFoundPage = lazy(() =>
  import("./pages/NotFoundPage").then((module) => ({ default: module.NotFoundPage })),
);
const ProductUnavailablePage = lazy(() =>
  import("./pages/ProductUnavailablePage").then((module) => ({
    default: module.ProductUnavailablePage,
  })),
);
const RecommendationsPage = lazy(() =>
  import("./pages/RecommendationsPage").then((module) => ({
    default: module.RecommendationsPage,
  })),
);
const ResumeConfirmPage = lazy(() =>
  import("./pages/ResumeConfirmPage").then((module) => ({
    default: module.ResumeConfirmPage,
  })),
);
const ResumePage = lazy(() =>
  import("./pages/ResumePage").then((module) => ({ default: module.ResumePage })),
);
const ResumeTailoringPage = lazy(() =>
  import("./pages/ResumeTailoringPage").then((module) => ({
    default: module.ResumeTailoringPage,
  })),
);
const ResearchJobDetailPage = lazy(() =>
  import("./research/ResearchJobDetailPage").then((module) => ({
    default: module.ResearchJobDetailPage,
  })),
);
const ResearchJobListPage = lazy(() =>
  import("./research/ResearchJobListPage").then((module) => ({
    default: module.ResearchJobListPage,
  })),
);

function LegacyResumeConfirmRedirect() {
  const { analysisId = "" } = useParams();
  return <Navigate to={`/resumes/import/confirm/${encodeURIComponent(analysisId)}`} replace />;
}

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
      <Suspense fallback={<div className="route-loading">正在检查产品访问状态…</div>}>
        <Routes>
          <Route path="*" element={<ProductUnavailablePage />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<div className="route-loading">正在打开求职工作台…</div>}>
      <Routes>
        <Route
          path="/"
          element={<Navigate to={careerOsV2Enabled ? "/today" : "/jobs"} replace />}
        />
        <Route
          element={
            careerOsV2Enabled ? (
              <WorkspaceShell accessRequired={alphaAccessRequired} />
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
              <Route path="/jobs" element={<JobDiscoveryPage />} />
              <Route path="/jobs/recommended" element={<JobRecommendationsPage />} />
              <Route path="/jobs/recommended/:runId" element={<JobRecommendationsPage />} />
              <Route path="/jobs/insights" element={<JobInsightsWorkspacePage />} />
              <Route path="/jobs/insights/:runId" element={<JobInsightsWorkspacePage />} />
              <Route path="/jobs/:jobId" element={<JobWorkspacePage />} />
              <Route path="/applications" element={<ApplicationsPage />} />
              <Route path="/applications/:caseId" element={<Navigate to="overview" replace />} />
              <Route path="/applications/:caseId/:tab" element={<CaseWorkspacePage />} />
              <Route path="/resumes/import" element={<ResumePage />} />
              <Route path="/resumes/import/confirm/:analysisId" element={<ResumeConfirmPage />} />
              <Route path="/resumes" element={<ResumeAssetsPage />} />
              <Route path="/resumes/:documentId" element={<ResumeAssetsPage />} />
              <Route path="/settings/data" element={<CareerDataControlPage />} />
              <Route path="/settings/data/deletion" element={<DeletionStatusPage />} />
              <Route
                path="/recommendations/*"
                element={<Navigate to="/jobs/recommended" replace />}
              />
              <Route path="/insights/*" element={<Navigate to="/jobs/insights" replace />} />
              <Route path="/resume" element={<Navigate to="/resumes/import" replace />} />
              <Route path="/resume/confirm/:analysisId" element={<LegacyResumeConfirmRedirect />} />
              <Route path="/resume/*" element={<Navigate to="/resumes/import" replace />} />
              <Route path="/resume-tailorings/:runId" element={<ResumeTailoringPage readOnly />} />
              <Route path="/data-control" element={<Navigate to="/settings/data" replace />} />
              <Route
                path="/data-control/deletion"
                element={<Navigate to="/settings/data/deletion" replace />}
              />
              <Route path="*" element={<WorkspaceNotFoundPage />} />
            </>
          ) : (
            <>
              <Route path="/jobs" element={<JobListPage />} />
              <Route path="/jobs/:jobId" element={<JobDetailPage />} />
              <Route path="/insights" element={<JobInsightsPage />} />
              <Route path="/resume" element={<ResumePage />} />
              <Route path="/resume/confirm/:analysisId" element={<ResumeConfirmPage />} />
              <Route path="/recommendations" element={<RecommendationsPage />} />
              <Route path="/resume-tailorings/:runId" element={<ResumeTailoringPage />} />
              <Route path="/data-control" element={<DataControlPage />} />
              <Route path="/data-control/deletion" element={<DeletionStatusPage />} />
            </>
          )}
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
    </Suspense>
  );
}

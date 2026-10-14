import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import {
  shouldEnableInternalSurfaces,
  shouldEnableProductSurfaces,
  shouldRequireAlphaAccess,
} from "./environment";
import { ResearchShell } from "./research/ResearchShell";

const GuidesPage = lazy(() =>
  import("./career-os/studio/GuidesPage").then((m) => ({ default: m.GuidesPage })),
);
const MaterialsWorkspace = lazy(() =>
  import("./career-os/studio/MaterialsWorkspace").then((m) => ({ default: m.MaterialsWorkspace })),
);
const AiSettingsPage = lazy(() =>
  import("./career-os/studio/AiSettingsPage").then((m) => ({ default: m.AiSettingsPage })),
);
const LegacyResumeRecoveryPage = lazy(() =>
  import("./career-os/studio/LegacyResumeRecoveryPage").then((m) => ({
    default: m.LegacyResumeRecoveryPage,
  })),
);
const NativeStudioPage = lazy(() =>
  import("./career-os/native/NativeStudioPage").then((m) => ({ default: m.NativeStudioPage })),
);
const AssistantWorkspace = lazy(() =>
  import("./career-os/studio/AssistantWorkspace").then((m) => ({ default: m.AssistantWorkspace })),
);

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
const CareerDeletionStatusPage = lazy(() =>
  import("./career-os/pages/CareerDeletionStatusPage").then((module) => ({
    default: module.CareerDeletionStatusPage,
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
const CurrentJobGraphPage = lazy(() =>
  import("./career-os/pages/CurrentJobGraphPage").then((module) => ({
    default: module.CurrentJobGraphPage,
  })),
);
const PlannerWorkspacePage = lazy(() =>
  import("./career-os/pages/PlannerWorkspacePage").then((module) => ({
    default: module.PlannerWorkspacePage,
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
const ProductUnavailablePage = lazy(() =>
  import("./pages/ProductUnavailablePage").then((module) => ({
    default: module.ProductUnavailablePage,
  })),
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
        <Route path="/" element={<Navigate to="/today" replace />} />
        <Route element={<WorkspaceShell accessRequired={alphaAccessRequired} />}>
          <Route path="/today" element={<CareerOsHomePage />} />
          <Route path="/jobs" element={<JobDiscoveryPage />} />
          <Route path="/jobs/recommended" element={<JobRecommendationsPage />} />
          <Route path="/jobs/recommended/:runId" element={<JobRecommendationsPage />} />
          <Route path="/jobs/insights" element={<CurrentJobGraphPage />} />
          <Route path="/jobs/insights/:runId" element={<JobInsightsWorkspacePage />} />
          <Route path="/jobs/:jobId" element={<JobWorkspacePage />} />
          <Route path="/applications" element={<ApplicationsPage />} />
          <Route path="/applications/planner" element={<PlannerWorkspacePage />} />
          <Route path="/applications/:caseId" element={<Navigate to="overview" replace />} />
          <Route path="/applications/:caseId/:tab" element={<CaseWorkspacePage />} />
          <Route path="/resumes/import" element={<Navigate to="/resumes?start=import" replace />} />
          <Route
            path="/resumes/import/confirm/:analysisId"
            element={<LegacyResumeRecoveryPage />}
          />
          <Route path="/resumes" element={<ResumeAssetsPage />} />
          <Route path="/resumes/native" element={<Navigate to="/resumes" replace />} />
          <Route path="/resumes/native/:documentId" element={<NativeStudioPage />} />
          <Route path="/assistant" element={<AssistantWorkspace />} />
          <Route path="/interviews" element={<AssistantWorkspace defaultTask="interview" />} />
          <Route path="/materials" element={<MaterialsWorkspace />} />
          <Route path="/guides" element={<GuidesPage />} />
          <Route
            path="/resumes/snippets"
            element={<Navigate to="/materials?view=expressions" replace />}
          />
          <Route path="/experiences" element={<Navigate to="/materials" replace />} />
          <Route path="/resumes/:documentId" element={<NativeStudioPage />} />
          <Route path="/settings/ai" element={<AiSettingsPage />} />
          <Route path="/settings/data" element={<CareerDataControlPage />} />
          <Route path="/settings/data/deletion" element={<CareerDeletionStatusPage />} />
          <Route path="/recommendations/*" element={<Navigate to="/jobs/recommended" replace />} />
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
          <Route
            path="/data-control/deletion/*"
            element={<Navigate to="/settings/data/deletion" replace />}
          />
          <Route path="/data-control/*" element={<Navigate to="/settings/data" replace />} />
          <Route path="*" element={<WorkspaceNotFoundPage />} />
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
      </Routes>
    </Suspense>
  );
}

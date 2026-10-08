import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./AppShell";
import { LoginPage } from "@/features/auth/LoginPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { useAuthStore } from "@/stores/auth-store";
import { useInvoiceStore } from "@/stores/invoice-store";
import { api } from "@/lib/api-client";
import { syncTeamWorkflow } from "@/lib/workflow-sync";
import { hydrateJobFromServer, resetJobSync, startJobAutosave } from "@/lib/job-sync";

const UploadPage = lazy(() => import("@/features/upload/UploadPage").then((m) => ({ default: m.UploadPage })));
const ReviewPage = lazy(() => import("@/features/review/ReviewPage").then((m) => ({ default: m.ReviewPage })));
const ManualEntryPage = lazy(() => import("@/features/manual-entry/ManualEntryPage").then((m) => ({ default: m.ManualEntryPage })));
const TaxCalculatorPage = lazy(() => import("@/features/tax-calculator/TaxCalculatorPage").then((m) => ({ default: m.TaxCalculatorPage })));
const WorksheetPage = lazy(() => import("@/features/worksheet/WorksheetPage").then((m) => ({ default: m.WorksheetPage })));
const FlowBoardPage = lazy(() => import("@/features/flowboard/FlowBoardPage").then((m) => ({ default: m.FlowBoardPage })));
const BrokeragePage = lazy(() => import("@/features/brokerage/BrokeragePage").then((m) => ({ default: m.BrokeragePage })));
const AsycudaPage = lazy(() => import("@/features/asycuda/AsycudaPage").then((m) => ({ default: m.AsycudaPage })));
const ReportsPage = lazy(() => import("@/features/reports/ReportsPage").then((m) => ({ default: m.ReportsPage })));
const LearnedPage = lazy(() => import("@/features/learned/LearnedPage").then((m) => ({ default: m.LearnedPage })));
const UsersPage = lazy(() => import("@/features/admin/UsersPage").then((m) => ({ default: m.UsersPage })));
const AdminIntegrationsPage = lazy(() => import("@/features/admin/AdminIntegrationsPage").then((m) => ({ default: m.AdminIntegrationsPage })));
const SupplierHistoryPage = lazy(() => import("@/features/admin/SupplierHistoryPage").then((m) => ({ default: m.SupplierHistoryPage })));
const ProductDictionaryPage = lazy(() => import("@/features/admin/ProductDictionaryPage").then((m) => ({ default: m.ProductDictionaryPage })));
const IndustryDictionaryPage = lazy(() => import("@/features/admin/IndustryDictionaryPage").then((m) => ({ default: m.IndustryDictionaryPage })));
const BrandDictionaryPage = lazy(() => import("@/features/admin/BrandDictionaryPage").then((m) => ({ default: m.BrandDictionaryPage })));
const QuestionRulesPage = lazy(() => import("@/features/admin/QuestionRulesPage").then((m) => ({ default: m.QuestionRulesPage })));
const ChapterPredictionRulesPage = lazy(() => import("@/features/admin/ChapterPredictionRulesPage").then((m) => ({ default: m.ChapterPredictionRulesPage })));
const ProductProfilesPage = lazy(() => import("@/features/admin/ProductProfilesPage").then((m) => ({ default: m.ProductProfilesPage })));
const SupplierIntelligencePage = lazy(() => import("@/features/admin/SupplierIntelligencePage").then((m) => ({ default: m.SupplierIntelligencePage })));
const LearningStatsPage = lazy(() => import("@/features/admin/LearningStatsPage").then((m) => ({ default: m.LearningStatsPage })));
const AttributeLibraryPage = lazy(() => import("@/features/admin/AttributeLibraryPage").then((m) => ({ default: m.AttributeLibraryPage })));
const LiquidCompositionRulesPage = lazy(() =>
  import("@/features/admin/LiquidCompositionRulesPage").then((m) => ({ default: m.LiquidCompositionRulesPage })),
);
const AbbreviationsPage = lazy(() =>
  import("@/features/admin/AbbreviationsPage").then((m) => ({ default: m.AbbreviationsPage })),
);
const SupplierCataloguePage = lazy(() =>
  import("@/features/admin/SupplierCataloguePage").then((m) => ({ default: m.SupplierCataloguePage })),
);

function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm" style={{ color: "var(--text2)" }}>
      Loading page…
    </div>
  );
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (user?.role !== "admin") return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function ProtectedRoutes() {
  const user = useAuthStore((s) => s.user);
  const setLearnedMap = useInvoiceStore((s) => s.setLearnedMap);
  const setSupplierHistory = useInvoiceStore((s) => s.setSupplierHistory);

  useEffect(() => {
    if (!user) return;
    const load = () => {
      api.getLearned().then(({ entries }) => setLearnedMap(entries)).catch(() => null);
      api.getSupplierHistory({ limit: 500 }).then(({ entries }) => setSupplierHistory(entries)).catch(() => null);
      syncTeamWorkflow().catch(() => null);
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(load, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(load, 100);
    return () => window.clearTimeout(timer);
  }, [user, setLearnedMap, setSupplierHistory]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let stopAutosave: (() => void) | null = null;
    hydrateJobFromServer()
      .catch(() => null)
      .finally(() => {
        if (!cancelled) stopAutosave = startJobAutosave();
      });
    return () => {
      cancelled = true;
      stopAutosave?.();
      resetJobSync();
    };
  }, [user]);

  if (!user) return <Navigate to="/login" replace />;
  return (
    <AppShell>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/classification" element={<ReviewPage />} />
        <Route path="/review" element={<Navigate to="/classification" replace />} />
        <Route path="/duties-taxes" element={<TaxCalculatorPage />} />
        <Route path="/taxes" element={<Navigate to="/duties-taxes" replace />} />
        <Route path="/worksheet" element={<WorksheetPage />} />
        <Route path="/flowboard" element={<FlowBoardPage />} />
        <Route path="/asycuda" element={<AsycudaPage />} />
        <Route path="/manual" element={<ManualEntryPage />} />
        <Route path="/brokerage" element={<BrokeragePage />} />
        <Route path="/learned" element={<LearnedPage />} />
        <Route
          path="/admin/supplier-history"
          element={
            <AdminRoute>
              <SupplierHistoryPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/product-dictionary"
          element={
            <AdminRoute>
              <ProductDictionaryPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/industry-dictionary"
          element={
            <AdminRoute>
              <IndustryDictionaryPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/brand-dictionary"
          element={
            <AdminRoute>
              <BrandDictionaryPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/question-rules"
          element={
            <AdminRoute>
              <QuestionRulesPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/chapter-rules"
          element={
            <AdminRoute>
              <ChapterPredictionRulesPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/product-profiles"
          element={
            <AdminRoute>
              <ProductProfilesPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/supplier-intelligence"
          element={
            <AdminRoute>
              <SupplierIntelligencePage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/learning-stats"
          element={
            <AdminRoute>
              <LearningStatsPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/attribute-library"
          element={
            <AdminRoute>
              <AttributeLibraryPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/liquid-composition"
          element={
            <AdminRoute>
              <LiquidCompositionRulesPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/abbreviations"
          element={
            <AdminRoute>
              <AbbreviationsPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/supplier-catalogue"
          element={
            <AdminRoute>
              <SupplierCataloguePage />
            </AdminRoute>
          }
        />
        <Route path="/reports" element={<ReportsPage />} />
        <Route
          path="/users"
          element={
            <AdminRoute>
              <UsersPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/integrations"
          element={
            <AdminRoute>
              <AdminIntegrationsPage />
            </AdminRoute>
          }
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}

export function App() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const checkSession = useAuthStore((s) => s.checkSession);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2" style={{ background: "var(--bg)", color: "var(--text2)" }}>
        <div>Loading DutyDesk…</div>
        <div className="text-xs" style={{ color: "var(--text3)" }}>
          If this takes more than a few seconds, check your network or try a hard refresh (Ctrl+Shift+R).
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
        <Route path="/*" element={<ProtectedRoutes />} />
      </Routes>
    </BrowserRouter>
  );
}

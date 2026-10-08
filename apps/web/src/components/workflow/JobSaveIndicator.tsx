import { InfoBanner } from "@/components/ui/banners";
import { useJobSyncStore } from "@/stores/job-sync-store";

export function JobSaveIndicator() {
  const saveState = useJobSyncStore((s) => s.saveState);
  const error = useJobSyncStore((s) => s.error);
  if (saveState !== "error" && saveState !== "closed") return null;
  return (
    <InfoBanner tone={saveState === "closed" ? "info" : "warn"} className="mb-3">
      {error}
    </InfoBanner>
  );
}
